package push

import (
	"context"
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

	var out Delivery
	for _, device := range devices {
		if ctx.Err() != nil {
			// Not tried: neither sent nor failed.
			break
		}
		outcome, answered := s.sendTo(ctx, sender, device, message, opts)
		if outcome == Delivered {
			out.Sent++
		} else {
			out.Failed++
		}
		if !answered {
			// Refused before any request (a bad option, a key that cannot be used):
			// the device did not answer, so it is neither counted nor deleted.
			app.Logger().Warn("push: a message was not sent: it was refused before the request")
			continue
		}
		record(app, device, outcome)
	}
	app.Logger().Debug("push: devices reached", "sent", out.Sent, "failed", out.Failed)
	return out, nil
}

// sendTo posts the message to one device. A device whose stored keys cannot be
// used is refused before any request; answered says whether the push service
// answered (a Rejected with no answer is not the device's doing).
func (s *Service) sendTo(ctx context.Context, sender *Sender, device *core.Record,
	message func(lang string) Message, opts Options) (outcome Outcome, answered bool) {
	p256dh, err1 := b64url.DecodeString(device.GetString("p256dh"))
	auth, err2 := b64url.DecodeString(device.GetString("auth"))
	if err1 != nil || err2 != nil {
		return Rejected, false
	}
	m := message(device.GetString("lang"))
	body, err := json.Marshal(payload{Title: m.Title, Body: m.Body, URL: m.URL, Tag: m.Tag})
	if err != nil {
		return Rejected, false
	}
	outcome, err = sender.Send(ctx, Subscription{Endpoint: device.GetString("endpoint"), P256dh: p256dh, Auth: auth}, body, opts)
	// A Rejected with an error never reached the push service. Any other error is
	// a request that failed on the way (Failed), which does count.
	return outcome, !(outcome == Rejected && err != nil)
}

// record writes what a delivery came to. A write that fails is logged without
// the device, and does not stop the others.
func record(app core.App, device *core.Record, outcome Outcome) {
	var err error
	switch outcome {
	case Delivered:
		device.Set("last_success_at", types.NowDateTime())
		device.Set("failures", 0)
		err = app.Save(device)
	case Gone:
		err = app.Delete(device)
	default:
		failures := device.GetInt("failures") + 1
		if failures >= maxFailures {
			err = app.Delete(device)
			break
		}
		device.Set("failures", failures)
		err = app.Save(device)
	}
	if err != nil {
		app.Logger().Error("push: a delivery could not be recorded", "error", errors.New("the database refused it"))
	}
}
