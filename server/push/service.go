package push

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"

	"courses/server/config"
)

// keyFileName is the file of the VAPID keys, in the data directory.
const keyFileName = "push_vapid.json"

// maxFailures is how many deliveries in a row a device may miss before its
// subscription is deleted.
const maxFailures = 10

// ErrUnavailable is what SendToUser returns when the keys could not be read
// (or on the demo): nothing is sent.
var ErrUnavailable = errors.New("push: the notifications are not available")

// Message is what a device shows. URL is a path of the site, Tag replaces a
// notification of the same tag that the device still shows.
type Message struct{ Title, Body, URL, Tag string }

// Delivery counts the devices of one sending: those that took the message, and
// those that did not (deleted ones included).
type Delivery struct{ Sent, Failed int }

// Service sends notifications to the devices of the accounts. Register makes
// it; its keys are read, or made, when the program starts to serve.
type Service struct {
	cfg  config.Config
	once sync.Once

	mu     sync.Mutex
	keys   *Keys
	sender *Sender
	// newSender makes the sender once the keys are known (the tests make another).
	newSender func(*Keys) *Sender

	// tests limits the sending of the test message: one per account and 30 s.
	tests *testLimiter
}

// Available says whether the keys could be read (and this is not the demo).
func (s *Service) Available() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.keys != nil
}

// publicKey is the key that a browser subscribes with, "" when there is none.
func (s *Service) publicKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.keys == nil {
		return ""
	}
	return s.keys.PublicKey()
}

// load reads the keys of the data directory, or makes them the first time. A
// file that is there and cannot be read is logged, left alone, and the service
// is unavailable: replacing it would cut every device off.
func (s *Service) load(app core.App) {
	s.once.Do(func() {
		keys, err := LoadOrCreateKeys(filepath.Join(app.DataDir(), keyFileName))
		if err != nil {
			// The error never holds the path, a key or the content of the file.
			app.Logger().Error("push: the notifications are unavailable", "error", err)
			return
		}
		s.mu.Lock()
		s.keys = keys
		s.mu.Unlock()
	})
}

// current returns the sender, made on first use, or nil without keys.
func (s *Service) current() *Sender {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.keys == nil {
		return nil
	}
	if s.sender == nil {
		s.sender = s.newSender(s.keys)
	}
	return s.sender
}

// payload is the encrypted JSON of a notification: what sw.js reads.
type payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

// SendToUser sends message(lang) to every device of the account, each in its
// own language, and records each outcome: delivered, the date and no failure;
// gone, the device is deleted; refused or failed, one more failure, and the
// device is deleted at ten. It never logs an endpoint, a key or a message.
//
// The error is for what stops the sending (no keys, the table cannot be read),
// never for a device that did not answer.
func (s *Service) SendToUser(ctx context.Context, app core.App, userID string,
	message func(lang string) Message, opts Options) (Delivery, error) {
	sender := s.current()
	if sender == nil {
		return Delivery{}, ErrUnavailable
	}
	devices, err := app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": userID})
	if err != nil {
		return Delivery{}, errors.New("push: the devices cannot be read")
	}

	// What each device is sent is made here, one after the other (the message
	// function is the caller's); the requests then go out together, so that a
	// slow push service holds the sending for one timeout and not for ten.
	type job struct {
		device  *core.Record
		sub     Subscription
		body    []byte
		outcome Outcome
		// answered: the push service answered. skipped: our own context ended
		// first, which says nothing about the device.
		answered, skipped bool
	}
	jobs := make([]*job, len(devices))
	for i, device := range devices {
		jobs[i] = &job{device: device}
		jobs[i].sub, jobs[i].body = prepare(device, message)
	}
	var wg sync.WaitGroup
	for _, j := range jobs {
		if j.body == nil {
			j.outcome = Rejected // refused before any request: a key that cannot be used
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			outcome, err := sender.Send(ctx, j.sub, j.body, opts)
			if ctx.Err() != nil {
				// Cancelled, or out of time, in the course of the request: that is
				// our doing, not the device's.
				j.skipped = true
				return
			}
			j.outcome = outcome
			// A Rejected with an error never reached the push service. Any other
			// error is a request that failed on the way (Failed), which does count.
			j.answered = !(outcome == Rejected && err != nil)
		}()
	}
	wg.Wait()

	var out Delivery
	for _, j := range jobs {
		switch {
		case j.skipped:
			continue // not tried to the end: neither sent nor failed
		case j.outcome == Delivered:
			out.Sent++
		default:
			out.Failed++
		}
		if j.body == nil {
			// Stored keys that cannot be decoded will never work: the device goes.
			if err := app.Delete(j.device); err != nil {
				app.Logger().Error("push: a delivery could not be recorded", "error", errors.New("the database refused it"))
			}
			continue
		}
		if !j.answered {
			// Refused before any request (a bad option): the device did not answer,
			// so it is neither counted nor deleted.
			app.Logger().Warn("push: a message was not sent: it was refused before the request")
			continue
		}
		record(app, j.device, j.sub.Endpoint, j.outcome)
	}
	app.Logger().Debug("push: devices reached", "sent", out.Sent, "failed", out.Failed)
	return out, nil
}

// prepare reads the subscription of a device and makes its message. A nil body
// says that the stored keys cannot be decoded or the message cannot be written.
func prepare(device *core.Record, message func(lang string) Message) (Subscription, []byte) {
	p256dh, err1 := b64url.DecodeString(device.GetString("p256dh"))
	auth, err2 := b64url.DecodeString(device.GetString("auth"))
	if err1 != nil || err2 != nil {
		return Subscription{}, nil
	}
	m := message(device.GetString("lang"))
	body, err := json.Marshal(payload{Title: m.Title, Body: m.Body, URL: m.URL, Tag: m.Tag})
	if err != nil {
		return Subscription{}, nil
	}
	return Subscription{Endpoint: device.GetString("endpoint"), P256dh: p256dh, Auth: auth}, body
}

// record writes what a delivery came to, on a fresh read of the row, in one
// transaction: the device may have been renewed (a new endpoint) or moved while
// the message was on its way, and a copy read before would put the old values
// back, or delete the row that now holds the new subscription. Such a row is
// left alone. Only the counter and the date are written. A write that fails is
// logged without the device, and does not stop the others.
func record(app core.App, sent *core.Record, endpoint string, outcome Outcome) {
	err := app.RunInTransaction(func(tx core.App) error {
		device, err := tx.FindRecordById("push_subscriptions", sent.Id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil // gone already
		}
		if err != nil {
			return err
		}
		if device.GetString("endpoint") != endpoint || device.GetString("user") != sent.GetString("user") {
			return nil // renewed or moved: this outcome is about the old subscription
		}
		switch outcome {
		case Delivered:
			device.Set("last_success_at", types.NowDateTime())
			device.Set("failures", 0)
			return tx.Save(device)
		case Gone:
			return tx.Delete(device)
		}
		failures := device.GetInt("failures") + 1
		if failures >= maxFailures {
			return tx.Delete(device)
		}
		device.Set("failures", failures)
		return tx.Save(device)
	})
	if err != nil {
		app.Logger().Error("push: a delivery could not be recorded", "error", errors.New("the database refused it"))
	}
}
