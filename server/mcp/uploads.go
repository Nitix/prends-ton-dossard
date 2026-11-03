package mcp

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"io"
	"net/http"
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
	uploadPerToken = 2         // slots of an MCP token; the oldest goes beyond
	uploadTotal    = 64 << 20  // bytes kept in all, or kept room for
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
// GPX file that parseGpx reads. errUploadInvalid when it is not one.
func sniff(p uploadPurpose, data []byte) (string, error) {
	switch p {
	case purposePhoto:
		if contentType := http.DetectContentType(data); slices.Contains(photoTypes, contentType) {
			return contentType, nil
		}
	case purposeTrack:
		if _, err := parseGpx(data); err == nil {
			return trackType, nil
		}
	}
	return "", errUploadInvalid
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
)

// The states of a slot.
const (
	slotWaiting   = iota // opened: its file has not come
	slotReceiving        // a PUT reads its file
	slotFilled           // its file is there
)

// uploadSlot is a slot: who opened it (the account and the MCP token), for
// what, the hash of its secret, and its file once it has come.
type uploadSlot struct {
	id, secretHash, userID, tokenID string
	purpose                         uploadPurpose
	data                            []byte // nil until the PUT
	contentType                     string
	expires                         time.Time
	state                           int
	// order tells the oldest of two slots opened at the same moment.
	order uint64
}

// uploads keeps the slots, in memory. bytes counts the files kept, and the room
// that each PUT under way holds for its file (its declared size, or the most its
// slot takes): what the slots hold never goes past uploadTotal.
type uploads struct {
	now   func() time.Time
	mu    sync.Mutex
	slots map[string]*uploadSlot
	bytes int
	made  uint64
}

// newUploads is the store of the app: Register gives it
// func() time.Time { return now() }, so that it reads the clock of the package.
func newUploads(now func() time.Time) *uploads {
	return &uploads{now: now, slots: map[string]*uploadSlot{}}
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

	for u.count(tokenID) >= uploadPerToken {
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
// slot, or past the declared length.
//
// The secret is compared in constant time with the hash of the slot's. A wrong
// one leaves the slot as it was. With the right one, the slot is used, whatever
// comes of it: a file over its size is errUploadTooLarge, one of the wrong type
// errUploadInvalid, and the slot is gone; a slot that a PUT reads already, or
// that is filled, is errUploadInvalid. Its file is told by what it holds
// (sniff); it is kept as it came.
func (u *uploads) put(id, secret string, size int64, body io.Reader) error {
	slot, reserved, err := u.receive(id, secret, size)
	if err != nil {
		return err
	}

	data, err := readAtMost(body, reserved)
	contentType := ""
	if err == nil {
		contentType, err = sniff(slot.purpose, data)
	}

	u.mu.Lock()
	defer u.mu.Unlock()
	u.bytes -= int(reserved)
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
	slot.data, slot.contentType, slot.state = data, contentType, slotFilled
	u.bytes += len(data)
	return nil
}

// receive checks a PUT, and holds the room of its file: the size it declares,
// or the most its slot takes. While the slots would go past uploadTotal with it,
// the oldest file goes; when no file can go, every byte being held by a PUT under
// way, the PUT is refused.
func (u *uploads) receive(id, secret string, size int64) (*uploadSlot, int64, error) {
	given := hashSecret(secret)

	u.mu.Lock()
	defer u.mu.Unlock()
	u.sweep(u.now())

	slot := u.slots[id]
	if slot == nil || subtle.ConstantTimeCompare([]byte(given), []byte(slot.secretHash)) != 1 || slot.state != slotWaiting {
		return nil, 0, errUploadInvalid
	}
	limit := slot.purpose.maxBytes()
	if size > limit {
		u.drop(id)
		return nil, 0, errUploadTooLarge
	}
	reserved := limit
	if size >= 0 {
		reserved = size
	}
	for u.bytes+int(reserved) > uploadTotal {
		if !u.dropOldest(func(s *uploadSlot) bool { return s.state == slotFilled }) {
			return nil, 0, errUploadInvalid
		}
	}
	u.bytes += int(reserved)
	slot.state = slotReceiving
	return slot, reserved, nil
}

// readAtMost reads body, which must hold max bytes at most: errUploadTooLarge
// beyond (and the reading stops there), errUploadInvalid when it cannot be read
// (the client went away).
func readAtMost(body io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, max+1))
	var tooLarge *http.MaxBytesError
	switch {
	case int64(len(data)) > max, errors.As(err, &tooLarge):
		return nil, errUploadTooLarge
	case err != nil:
		return nil, errUploadInvalid
	}
	return data, nil
}

// peek gives the file of a slot without freeing it: only for the MCP token that
// opened it, and its purpose. A risky first call hashes the bytes for its
// confirmation and leaves the slot to the second call; a refused peek leaves it
// too.
func (u *uploads) peek(id, tokenID string, p uploadPurpose) (data []byte, contentType string, err error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	slot, err := u.find(id, tokenID, p)
	if err != nil {
		return nil, "", err
	}
	return slot.data, slot.contentType, nil
}

// take is peek, and frees the slot: it hands the file to the tool that writes it.
func (u *uploads) take(id, tokenID string, p uploadPurpose) (data []byte, contentType string, err error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	slot, err := u.find(id, tokenID, p)
	if err != nil {
		return nil, "", err
	}
	u.drop(id)
	return slot.data, slot.contentType, nil
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
		u.bytes -= len(slot.data)
		delete(u.slots, id)
	}
}

// count is the number of slots of the MCP token tokenID.
func (u *uploads) count(tokenID string) int {
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

// uploadRoute is PUT /api/app/mcp-uploads/{id}: the file of a slot, as it is,
// with its secret in the X-Upload-Secret header. It has no session: the secret
// is the right to fill the slot, which a page elsewhere does not know (no cookie
// or session stands for it, and a browser sends a custom header only to a page
// that the CORS of the site lets it, after a preflight). The secret is never in
// the address, so never in the request log. Any refusal of the slot is a 400
// upload_invalid, which never says which; a file over its size is a 413.
func uploadRoute(store *uploads) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// The most that a slot takes: the slot's own size is checked by put. Over
		// it, the server stops reading the request.
		body := http.MaxBytesReader(e.Response, e.Request.Body, trackMaxBytes)
		err := store.put(e.Request.PathValue("id"), e.Request.Header.Get(secretHeader), e.Request.ContentLength, body)
		switch {
		case err == nil:
			return e.NoContent(http.StatusNoContent)
		case errors.Is(err, errUploadTooLarge):
			return e.Error(http.StatusRequestEntityTooLarge, "", nil)
		}
		return apperr.New(http.StatusBadRequest, apperr.CodeUploadInvalid)
	}
}
