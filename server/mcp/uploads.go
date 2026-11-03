package mcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"io"
	"net/http"
	"os"
	"slices"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
)

// The upload slots (spec § 6.9). An assistant has no file field: a file comes
// to a tool in base64, when it is small, or in two steps: start_upload opens a
// slot and gives its address and its secret, the file goes there by a PUT that
// carries the secret in a header, and the tool that needs it (set_photo,
// set_track) takes it by its id.
//
// The slots live in memory, like the confirmations: one instance runs, a slot
// lives ten minutes, and a restart only makes the assistant start again. A slot
// serves the MCP token that opened it, for its purpose, once.

const (
	uploadTTL      = 10 * time.Minute
	uploadPerToken = 2        // slots of an MCP token; the oldest goes beyond
	uploadTotal    = 64 << 20 // bytes kept in all, or kept room for
	// uploadPerAccount is what one account keeps, or keeps room for: it does not
	// take the room of the others, nor drop their files.
	uploadPerAccount = 20 << 20
	// putTimeout is how long the file of a slot may take to come.
	putTimeout     = 2 * time.Minute
	photoMaxBytes  = 5 << 20   // runners.avatar
	trackMaxBytes  = 10 << 20  // formats.gpx
	inlineMaxBytes = 512 << 10 // content_base64, decoded
	uploadsPath    = "/api/app/mcp-uploads"
	secretHeader   = "X-Upload-Secret"
)

// uploadPurpose is what a slot is for: "photo" (a runner's) or "track" (a
// format's GPX).
type uploadPurpose string

const (
	purposePhoto uploadPurpose = "photo"
	purposeTrack uploadPurpose = "track"
)

// maxBytes is the size of the biggest file that the field of the site takes for
// that purpose.
func (p uploadPurpose) maxBytes() int64 {
	if p == purposeTrack {
		return trackMaxBytes
	}
	return photoMaxBytes
}

// photoTypes are the types of image that runners.avatar takes.
var photoTypes = []string{"image/jpeg", "image/png", "image/webp"}

// trackType is the type that a track is sent with: the one the site gives a file
// that it adds the XML declaration to.
const trackType = "application/gpx+xml"

// sniff is the type of a file for that purpose, told from what it holds, as the
// field of the site will tell it: the signature of an image (photoTypes), or a
// GPX file that parseGpx reads, whose numbers it gives too (a track is read once,
// here, when a place to read it comes before the request ends: ctx).
// errUploadInvalid when it is not one, or when the request ended first.
func sniff(ctx context.Context, p uploadPurpose, data []byte) (string, *gpxStats, error) {
	switch p {
	case purposePhoto:
		if contentType := http.DetectContentType(data); slices.Contains(photoTypes, contentType) {
			return contentType, nil, nil
		}
	case purposeTrack:
		if stats, err := readTrack(ctx, data); err == nil {
			return trackType, &stats, nil
		}
	}
	return "", nil, errUploadInvalid
}

var (
	// errUploadInvalid is a slot that is not there, expired, filled already,
	// opened by another MCP token or for another purpose, or given a wrong
	// secret or a file of the wrong type: the route never says which.
	errUploadInvalid = errors.New("mcp: an upload slot that is not valid")
	// errUploadEmpty is a slot of the caller whose file has not come yet.
	errUploadEmpty = errors.New("mcp: an upload slot whose file has not come")
	// errUploadTooLarge is a file over the size of its slot.
	errUploadTooLarge = errors.New("mcp: a file over the size of its slot")
	// errUploadBusy is a store with no room now for the file of a slot: every
	// byte is held by the PUTs under way (of the account, or of all). The slot
	// still waits for its file.
	errUploadBusy = errors.New("mcp: no room for a file now")
	// errUploadTooSlow is a file that took more than putTimeout to come.
	errUploadTooSlow = errors.New("mcp: a file that came too slowly")
)

// The states of a slot.
const (
	slotWaiting   = iota // opened: its file has not come
	slotReceiving        // a PUT reads its file
	slotFilled           // its file is there
)

// uploadSlot is a slot: who opened it (the account and the MCP token), for
// what, the hash of its secret, and its file once it has come, with what the PUT
// read of a track.
type uploadSlot struct {
	id, secretHash, userID, tokenID string
	purpose                         uploadPurpose
	data                            []byte // nil until the PUT
	contentType                     string
	track                           *gpxStats // the numbers of a track
	expires                         time.Time
	state                           int
	// order tells the oldest of two slots opened at the same moment.
	order uint64
}

// storedFile is the file of a slot, as a tool gets it: its bytes, its type, when
// the slot expires (a confirmation is no good past it), and the numbers that the
// PUT read of a track.
type storedFile struct {
	data        []byte
	contentType string
	expires     time.Time
	track       *gpxStats
}

// uploads keeps the slots, in memory. bytes counts the files kept and the room
// that each PUT under way holds for its file (its declared size, or the most its
// slot takes), in all and by account: what the slots hold never goes past
// uploadTotal, nor uploadPerAccount for one account.
type uploads struct {
	now    func() time.Time
	mu     sync.Mutex
	slots  map[string]*uploadSlot
	bytes  int
	byUser map[string]int
	made   uint64
}

// newUploads is the store of the app: Register gives it
// func() time.Time { return now() }, so that it reads the clock of the package.
func newUploads(now func() time.Time) *uploads {
	return &uploads{now: now, slots: map[string]*uploadSlot{}, byUser: map[string]int{}}
}

// hold counts n more bytes for the account userID (n < 0 gives them back).
func (u *uploads) hold(userID string, n int) {
	u.bytes += n
	if u.byUser[userID] += n; u.byUser[userID] == 0 {
		delete(u.byUser, userID)
	}
}

// hashSecret is the hash that a slot keeps of its secret.
func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return string(sum[:])
}

// open makes a slot for the MCP token tokenID of the account userID, and returns
// its id, its secret ("ptu_" and 128 random bits) and when it expires. The
// slots that expired go first; then, while the token has uploadPerToken, its
// oldest.
func (u *uploads) open(userID, tokenID string, p uploadPurpose) (id, secret string, expires time.Time) {
	u.mu.Lock()
	defer u.mu.Unlock()
	now := u.now()
	u.sweep(now)

	for u.slotsOf(tokenID) >= uploadPerToken {
		u.dropOldest(func(s *uploadSlot) bool { return s.tokenID == tokenID })
	}
	for id == "" || u.slots[id] != nil {
		id = core.GenerateDefaultRandomId()
	}
	secret = "ptu_" + rand.Text()
	u.made++
	u.slots[id] = &uploadSlot{
		id: id, secretHash: hashSecret(secret), userID: userID, tokenID: tokenID,
		purpose: p, expires: now.Add(uploadTTL), order: u.made,
	}
	return id, secret, now.Add(uploadTTL)
}

// put fills the slot id with body, once. size is the length that the request
// declares (-1 when it does not): a file declared over the size of the slot is
// refused before a byte of it is read, and none is read past the size of the
// slot, or past the declared length, or past putTimeout.
//
// The secret is compared in constant time with the hash of the slot's. A wrong
// one leaves the slot as it was, and so does a store with no room now
// (errUploadBusy). Once the file comes, the slot is used, whatever comes of it: a
// file over its size is errUploadTooLarge, one too slow errUploadTooSlow, one of
// the wrong type errUploadInvalid, and the slot is gone; a slot that a PUT reads
// already, or that is filled, is errUploadInvalid. Its file is told by what it
// holds (sniff), a track read then, once, if a place to read it comes before the
// request ends (ctx); it is kept as it came.
func (u *uploads) put(ctx context.Context, id, secret string, size int64, body io.Reader) error {
	slot, held, start, err := u.receive(id, secret, size)
	if err != nil {
		return err
	}
	// The room is given back whatever happens: on a panic on the way too (none is
	// known), the slot, which was used, going with it.
	done := false
	defer func() {
		if done {
			return
		}
		u.mu.Lock()
		defer u.mu.Unlock()
		u.hold(slot.userID, -int(held))
		if u.slots[id] == slot {
			u.drop(id)
		}
	}()

	data, err := readAtMost(&timedReader{r: body, now: u.now, deadline: start.Add(putTimeout)}, held)
	var (
		contentType string
		track       *gpxStats
	)
	if err == nil {
		contentType, track, err = sniff(ctx, slot.purpose, data)
	}

	u.mu.Lock()
	defer u.mu.Unlock()
	done = true
	u.hold(slot.userID, -int(held))
	if u.slots[id] != slot {
		// Gone while its file came: expired, or dropped for a newer one.
		return errUploadInvalid
	}
	if err == nil && !u.now().Before(slot.expires) {
		err = errUploadInvalid
	}
	if err != nil {
		u.drop(id)
		return err
	}
	// The room held for it is enough: the file is no longer than it.
	slot.data, slot.contentType, slot.track, slot.state = data, contentType, track, slotFilled
	u.hold(slot.userID, len(data))
	return nil
}

// receive checks a PUT, and holds the room of its file: the size it declares, or
// the most its slot takes. While the account would go past uploadPerAccount with
// it, its own oldest file goes; then, while the slots would go past uploadTotal,
// the oldest file of all. When no file can go (every byte is held by PUTs under
// way), the PUT is errUploadBusy, and the slot waits. It returns when the PUT
// began.
func (u *uploads) receive(id, secret string, size int64) (*uploadSlot, int64, time.Time, error) {
	given := hashSecret(secret)

	u.mu.Lock()
	defer u.mu.Unlock()
	now := u.now()
	u.sweep(now)

	slot := u.slots[id]
	if slot == nil || subtle.ConstantTimeCompare([]byte(given), []byte(slot.secretHash)) != 1 || slot.state != slotWaiting {
		return nil, 0, time.Time{}, errUploadInvalid
	}
	limit := slot.purpose.maxBytes()
	if size > limit {
		u.drop(id)
		return nil, 0, time.Time{}, errUploadTooLarge
	}
	held := limit
	if size >= 0 {
		held = size
	}
	filled := func(s *uploadSlot) bool { return s.state == slotFilled }
	for u.byUser[slot.userID]+int(held) > uploadPerAccount {
		if !u.dropOldest(func(s *uploadSlot) bool { return filled(s) && s.userID == slot.userID }) {
			return nil, 0, time.Time{}, errUploadBusy
		}
	}
	for u.bytes+int(held) > uploadTotal {
		if !u.dropOldest(filled) {
			return nil, 0, time.Time{}, errUploadBusy
		}
	}
	u.hold(slot.userID, int(held))
	slot.state = slotReceiving
	return slot, held, now, nil
}

// timedReader cuts a body that is still coming at its deadline: a PUT that
// trickles holds the room of its file, which the others do not have meanwhile.
// (The route sets the same deadline on the connection, so that a body that stops
// coming at all is cut too.)
type timedReader struct {
	r        io.Reader
	now      func() time.Time
	deadline time.Time
}

func (t *timedReader) Read(p []byte) (int, error) {
	n, err := t.r.Read(p)
	if !t.now().Before(t.deadline) {
		return n, errUploadTooSlow
	}
	return n, err
}

// readAtMost reads body, which must hold max bytes at most: errUploadTooLarge
// beyond (and the reading stops there), errUploadTooSlow past its time,
// errUploadInvalid when it cannot be read (the client went away).
func readAtMost(body io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, max+1))
	var tooLarge *http.MaxBytesError
	switch {
	case int64(len(data)) > max, errors.As(err, &tooLarge):
		return nil, errUploadTooLarge
	case errors.Is(err, errUploadTooSlow), errors.Is(err, os.ErrDeadlineExceeded):
		return nil, errUploadTooSlow
	case err != nil:
		return nil, errUploadInvalid
	}
	return data, nil
}

// peek gives the file of a slot without freeing it: only for the MCP token that
// opened it, and its purpose. A risky first call hashes the bytes for its
// confirmation and leaves the slot to the second call; a refused peek leaves it
// too.
func (u *uploads) peek(id, tokenID string, p uploadPurpose) (storedFile, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	slot, err := u.find(id, tokenID, p)
	if err != nil {
		return storedFile{}, err
	}
	return slot.file(), nil
}

// take is peek, and frees the slot: it hands the file to the tool that writes it.
func (u *uploads) take(id, tokenID string, p uploadPurpose) (storedFile, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	slot, err := u.find(id, tokenID, p)
	if err != nil {
		return storedFile{}, err
	}
	u.drop(id)
	return slot.file(), nil
}

// file is the file of a filled slot.
func (s *uploadSlot) file() storedFile {
	return storedFile{data: s.data, contentType: s.contentType, expires: s.expires, track: s.track}
}

// find is the filled slot id of the MCP token tokenID for p. A slot of another
// token or purpose is errUploadInvalid, as one that is not there: the tool says
// nothing of the slots of others. The caller's own slot, whose file has not come,
// is errUploadEmpty.
func (u *uploads) find(id, tokenID string, p uploadPurpose) (*uploadSlot, error) {
	u.sweep(u.now())
	slot := u.slots[id]
	switch {
	case slot == nil || slot.tokenID != tokenID || slot.purpose != p:
		return nil, errUploadInvalid
	case slot.state != slotFilled:
		return nil, errUploadEmpty
	}
	return slot, nil
}

// sweep drops the slots that expired, with their files.
func (u *uploads) sweep(now time.Time) {
	for id, slot := range u.slots {
		if !now.Before(slot.expires) {
			u.drop(id)
		}
	}
}

// drop frees the slot id and its file. The room that a PUT under way holds is
// the PUT's to give back.
func (u *uploads) drop(id string) {
	if slot := u.slots[id]; slot != nil {
		u.hold(slot.userID, -len(slot.data))
		delete(u.slots, id)
	}
}

// slotsOf is the number of slots of the MCP token tokenID.
func (u *uploads) slotsOf(tokenID string) int {
	n := 0
	for _, slot := range u.slots {
		if slot.tokenID == tokenID {
			n++
		}
	}
	return n
}

// dropOldest drops the oldest of the slots that match, and says whether there
// was one.
func (u *uploads) dropOldest(match func(*uploadSlot) bool) bool {
	var oldest *uploadSlot
	for _, slot := range u.slots {
		if match(slot) && (oldest == nil || slot.order < oldest.order) {
			oldest = slot
		}
	}
	if oldest == nil {
		return false
	}
	u.drop(oldest.id)
	return true
}

// ---------------------------------------------------------------------------
// The route

// busyRetry is how long a client waits before it sends a file again, when the
// store has no room for it now.
const busyRetry = "60"

// uploadRoute is PUT /api/app/mcp-uploads/{id}: the file of a slot, as it is,
// with its secret in the X-Upload-Secret header. It has no session: the secret
// is the right to fill the slot, which a page elsewhere does not know (no cookie
// or session stands for it, and a browser sends a custom header only to a page
// that the CORS of the site lets it, after a preflight). The secret is never in
// the address, so never in the request log.
//
// Any refusal of the slot is a 400 upload_invalid, which never says which; a
// file over its size is a 413; one that took more than putTimeout a 408; a store
// with no room now a 503 with Retry-After, the slot still waiting.
func uploadRoute(store *uploads) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// A body that stops coming is cut at the time a PUT has, at the
		// connection (a test's recorder has none, which is not an error here).
		_ = http.NewResponseController(e.Response).SetReadDeadline(time.Now().Add(putTimeout))
		// The most that a slot takes: the slot's own size is checked by put. Over
		// it, the server stops reading the request.
		body := http.MaxBytesReader(e.Response, e.Request.Body, trackMaxBytes)
		err := store.put(e.Request.Context(), e.Request.PathValue("id"), e.Request.Header.Get(secretHeader), e.Request.ContentLength, body)
		switch {
		case err == nil:
			return e.NoContent(http.StatusNoContent)
		case errors.Is(err, errUploadTooLarge):
			return e.Error(http.StatusRequestEntityTooLarge, "", nil)
		case errors.Is(err, errUploadTooSlow):
			return e.Error(http.StatusRequestTimeout, "", nil)
		case errors.Is(err, errUploadBusy):
			e.Response.Header().Set("Retry-After", busyRetry)
			return e.Error(http.StatusServiceUnavailable, "Trop de fichiers arrivent en ce moment : renvoie celui-ci dans une minute, avec la même commande.", nil)
		}
		return apperr.New(http.StatusBadRequest, apperr.CodeUploadInvalid)
	}
}
