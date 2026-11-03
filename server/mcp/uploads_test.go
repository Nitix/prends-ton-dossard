package mcp_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/logger"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The upload slots (spec § 6.9): a file sent in two steps, start_upload, then a
// PUT with the secret in a header, kept in memory for the tool that takes it.

var (
	// slotID is the shape of the id of a slot.
	slotID = regexp.MustCompile(`^[a-z0-9]{15}$`)
	// slotSecret is the shape of its secret.
	slotSecret = regexp.MustCompile(`^ptu_[A-Z2-7]{26}$`)
)

// photoOf is a file that PocketBase and the store take for a PNG of size
// bytes: its signature, then zeros. The store only looks at the signature.
func photoOf(size int) []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, size-8)...)
}

// put fills a slot of the store with data, whose length it declares.
func put(u *mcp.Uploads, id, secret string, data []byte) error {
	return u.Put(id, secret, int64(len(data)), bytes.NewReader(data))
}

func TestUploads_Store(t *testing.T) {
	png := testutil.PNG(t, 8, 8)

	t.Run("a slot: open, put, peek twice, take once", func(t *testing.T) {
		c := newClock()
		u := mcp.NewUploads(c.now)
		id, secret, expires := u.Open("alice", "token-a", "photo")
		if !slotID.MatchString(id) || !slotSecret.MatchString(secret) {
			t.Fatalf("the slot %q has the secret %s, want an id and ptu_ + 26 characters", id, prefix(secret))
		}
		if !expires.Equal(c.at.Add(10 * time.Minute)) {
			t.Errorf("the slot expires at %v, want 10 minutes from now", expires)
		}
		if _, _, err := u.Peek(id, "token-a", "photo"); !errors.Is(err, mcp.ErrUploadEmpty) {
			t.Errorf("a slot not filled yet: %v, want it said empty", err)
		}

		if err := put(u, id, "ptu_"+strings.Repeat("A", 26), png); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a wrong secret: %v", err)
		}
		if err := put(u, id, "", png); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("no secret: %v", err)
		}
		// A wrong secret does not use the slot up: the right one still fills it.
		if err := put(u, id, secret, png); err != nil {
			t.Fatalf("put: %v", err)
		}
		if err := put(u, id, secret, png); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a second put: %v, want a refusal", err)
		}
		if u.Bytes() != len(png) {
			t.Errorf("the store keeps %d bytes, want %d", u.Bytes(), len(png))
		}

		for range 2 {
			data, contentType, err := u.Peek(id, "token-a", "photo")
			if err != nil || !bytes.Equal(data, png) || contentType != "image/png" {
				t.Fatalf("peek: %d bytes, %q, %v", len(data), contentType, err)
			}
		}
		// A refused peek leaves the slot: another MCP token, another purpose.
		if _, _, err := u.Peek(id, "token-b", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a peek of another token: %v", err)
		}
		if _, _, err := u.Peek(id, "token-a", "track"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a peek for another purpose: %v", err)
		}
		// So does a refused take.
		if _, _, err := u.Take(id, "token-b", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a take of another token: %v", err)
		}
		if _, _, err := u.Take(id, "token-a", "track"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a take for another purpose: %v", err)
		}
		if u.Len() != 1 {
			t.Fatalf("%d slots after the refusals, want 1", u.Len())
		}

		data, contentType, err := u.Take(id, "token-a", "photo")
		if err != nil || !bytes.Equal(data, png) || contentType != "image/png" {
			t.Fatalf("take: %d bytes, %q, %v", len(data), contentType, err)
		}
		if u.Len() != 0 || u.Bytes() != 0 {
			t.Errorf("after the take, %d slots and %d bytes, want none", u.Len(), u.Bytes())
		}
		if _, _, err := u.Take(id, "token-a", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a second take: %v", err)
		}
		if _, _, err := u.Peek(id, "token-a", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a peek after the take: %v", err)
		}
	})

	t.Run("ten minutes, then gone, with its memory", func(t *testing.T) {
		c := newClock()
		u := mcp.NewUploads(c.now)
		id, secret, _ := u.Open("alice", "token-a", "photo")
		if err := put(u, id, secret, png); err != nil {
			t.Fatal(err)
		}
		c.advance(10*time.Minute - time.Second)
		if _, _, err := u.Peek(id, "token-a", "photo"); err != nil {
			t.Errorf("at 9 min 59 s: %v", err)
		}
		c.advance(time.Second)
		if _, _, err := u.Peek(id, "token-a", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("at 10 min: %v, want a refusal", err)
		}
		if u.Len() != 0 || u.Bytes() != 0 {
			t.Errorf("after 10 min, %d slots and %d bytes, want none", u.Len(), u.Bytes())
		}

		// A slot that expires before its file comes refuses it.
		id, secret, _ = u.Open("alice", "token-a", "photo")
		c.advance(10 * time.Minute)
		if err := put(u, id, secret, png); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a put after 10 min: %v", err)
		}

		// A slot that expires while its file comes refuses it too: the PUT is not
		// told that a file was kept that no tool will get. (The PUT takes a minute,
		// well within its time.)
		id, secret, _ = u.Open("alice", "token-a", "photo")
		c.advance(9 * time.Minute)
		body, writer := io.Pipe()
		done := make(chan error, 1)
		go func() { done <- u.Put(id, secret, -1, body) }()
		if _, err := writer.Write(png[:8]); err != nil {
			t.Fatal(err)
		}
		c.advance(time.Minute)
		go func() {
			_, _ = writer.Write(png[8:])
			_ = writer.Close()
		}()
		err := <-done
		_ = body.Close()
		if !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a file that came once its slot expired: %v, want a refusal", err)
		}
		if u.Len() != 0 || u.Bytes() != 0 {
			t.Errorf("then %d slots and %d bytes, want none", u.Len(), u.Bytes())
		}

		// An expired slot goes at the next request of any kind, with its memory.
		id, secret, _ = u.Open("alice", "token-a", "photo")
		if err := put(u, id, secret, png); err != nil {
			t.Fatal(err)
		}
		c.advance(10 * time.Minute)
		u.Open("bob", "token-b", "track")
		if u.Len() != 1 || u.Bytes() != 0 {
			t.Errorf("after another slot, %d slots and %d bytes, want Bob's slot alone", u.Len(), u.Bytes())
		}
	})

	t.Run("two slots per MCP token: a third drops the oldest", func(t *testing.T) {
		c := newClock()
		u := mcp.NewUploads(c.now)
		other, otherSecret, _ := u.Open("bob", "token-b", "photo")
		first, firstSecret, _ := u.Open("alice", "token-a", "photo")
		second, secondSecret, _ := u.Open("alice", "token-a", "track")
		third, thirdSecret, _ := u.Open("alice", "token-a", "photo")

		if err := put(u, first, firstSecret, png); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("the oldest slot of the token: %v, want it gone", err)
		}
		for _, slot := range []struct{ id, secret string }{{other, otherSecret}, {third, thirdSecret}} {
			if err := put(u, slot.id, slot.secret, png); err != nil {
				t.Errorf("a slot that stays: %v", err)
			}
		}
		if err := put(u, second, secondSecret, testutil.GPX(t, 3)); err != nil {
			t.Errorf("the second slot of the token: %v", err)
		}
		if u.Len() != 3 {
			t.Errorf("%d slots, want 3", u.Len())
		}
	})

	t.Run("64 Mo in all: the oldest goes", func(t *testing.T) {
		c := newClock()
		u := mcp.NewUploads(c.now)
		five := photoOf(mcp.PhotoMaxBytes)
		var ids []string
		// Thirteen photos of 5 Mo, two per MCP token, of an account each: the
		// thirteenth goes past 64 Mo.
		for i := range 13 {
			token := "token-" + string(rune('a'+i/2))
			id, secret, _ := u.Open("person-"+token, token, "photo")
			if err := put(u, id, secret, five); err != nil {
				t.Fatalf("photo %d: %v", i+1, err)
			}
			ids = append(ids, id)
			if u.Bytes() > mcp.UploadTotal {
				t.Fatalf("after photo %d, %d bytes kept, over 64 Mo", i+1, u.Bytes())
			}
		}
		if _, _, err := u.Peek(ids[0], "token-a", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("the oldest photo: %v, want it gone", err)
		}
		if _, _, err := u.Peek(ids[1], "token-a", "photo"); err != nil {
			t.Errorf("the second photo: %v", err)
		}
		if _, _, err := u.Peek(ids[12], "token-g", "photo"); err != nil {
			t.Errorf("the last photo: %v", err)
		}
		if want := 12 * mcp.PhotoMaxBytes; u.Bytes() != want {
			t.Errorf("%d bytes kept, want %d", u.Bytes(), want)
		}
	})

	t.Run("the size, before the body is read", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)

		// Declared over the limit: refused without reading a byte.
		id, secret, _ := u.Open("alice", "token-a", "photo")
		unread := readerFunc(func([]byte) (int, error) {
			t.Error("the body of a file declared too big was read")
			return 0, io.EOF
		})
		if err := u.Put(id, secret, mcp.PhotoMaxBytes+1, unread); !errors.Is(err, mcp.ErrUploadTooLarge) {
			t.Errorf("a photo declared at 5 Mo + 1: %v", err)
		}
		// Undeclared (chunked), and over the limit: refused at the limit, the rest
		// not read.
		id, secret, _ = u.Open("alice", "token-a", "photo")
		counted := &countingReader{r: bytes.NewReader(photoOf(mcp.PhotoMaxBytes + 1<<20))}
		if err := u.Put(id, secret, -1, counted); !errors.Is(err, mcp.ErrUploadTooLarge) {
			t.Errorf("a photo of 6 Mo: %v", err)
		}
		if counted.n > mcp.PhotoMaxBytes+1 {
			t.Errorf("%d bytes read, want the limit and one more at most", counted.n)
		}
		// Declared shorter than it is: what it says is the most that is read.
		id, secret, _ = u.Open("alice", "token-a", "photo")
		if err := u.Put(id, secret, 100, bytes.NewReader(photoOf(200))); !errors.Is(err, mcp.ErrUploadTooLarge) {
			t.Errorf("a body longer than it says: %v", err)
		}
		// A refused file uses the slot up: the memory is free, and the slot gone.
		if u.Bytes() != 0 || u.Len() != 0 {
			t.Errorf("after the refusals, %d slots and %d bytes, want none", u.Len(), u.Bytes())
		}

		// Exactly the limit is a file.
		id, secret, _ = u.Open("alice", "token-a", "photo")
		if err := u.Put(id, secret, -1, bytes.NewReader(photoOf(mcp.PhotoMaxBytes))); err != nil {
			t.Errorf("a photo of 5 Mo: %v", err)
		}
		// A track goes to 10 Mo.
		big := append(testutil.GPX(t, 2), bytes.Repeat([]byte(" "), mcp.TrackMaxBytes-len(testutil.GPX(t, 2)))...)
		id, secret, _ = u.Open("alice", "token-b", "track")
		if err := put(u, id, secret, big); err != nil {
			t.Errorf("a track of 10 Mo: %v", err)
		}
		id, secret, _ = u.Open("alice", "token-b", "track")
		if err := put(u, id, secret, append(big, ' ')); !errors.Is(err, mcp.ErrUploadTooLarge) {
			t.Errorf("a track of 10 Mo + 1: %v", err)
		}
	})

	t.Run("the type, by the content", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		for _, row := range []struct {
			name, purpose string
			data          []byte
			contentType   string
		}{
			{"a PNG", "photo", png, "image/png"},
			{"a JPEG", "photo", append([]byte("\xFF\xD8\xFF\xE0"), make([]byte, 100)...), "image/jpeg"},
			{"a WebP", "photo", append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 100)...), "image/webp"},
			{"a GPX", "track", testutil.GPX(t, 3), "application/gpx+xml"},
			{"a GPX without its declaration", "track", bytes.TrimPrefix(testutil.GPX(t, 3), []byte(`<?xml version="1.0" encoding="UTF-8"?>`+"\n")), "application/gpx+xml"},
			{"a text for a photo", "photo", []byte("pas une image"), ""},
			{"a GIF for a photo", "photo", []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), ""},
			{"a SVG for a photo", "photo", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), ""},
			{"a PNG for a track", "track", png, ""},
			{"a GPX for a photo", "photo", testutil.GPX(t, 3), ""},
			{"a GPX without a point", "track", gpxDoc(""), ""},
			{"an empty file", "track", nil, ""},
		} {
			t.Run(row.name, func(t *testing.T) {
				id, secret, _ := u.Open("alice", "token-"+row.name, row.purpose)
				err := put(u, id, secret, row.data)
				if row.contentType == "" {
					if !errors.Is(err, mcp.ErrUploadInvalid) {
						t.Errorf("put: %v, want a refusal", err)
					}
					if _, _, err := u.Peek(id, "token-"+row.name, row.purpose); !errors.Is(err, mcp.ErrUploadInvalid) {
						t.Errorf("the slot of a refused file: %v, want it gone", err)
					}
					return
				}
				if err != nil {
					t.Fatalf("put: %v", err)
				}
				// The store keeps the file as it came.
				data, contentType, err := u.Peek(id, "token-"+row.name, row.purpose)
				if err != nil || contentType != row.contentType || !bytes.Equal(data, row.data) {
					t.Errorf("peek: %d bytes, %q, %v; want %q", len(data), contentType, err, row.contentType)
				}
			})
		}
	})

	t.Run("one PUT at a time", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		id, secret, _ := u.Open("alice", "token-a", "photo")
		body, writer := io.Pipe()
		done := make(chan error, 1)
		go func() { done <- u.Put(id, secret, -1, body) }()
		// The first bytes are read: the PUT is under way.
		written := make(chan error, 1)
		go func() {
			_, err := writer.Write(png[:8])
			written <- err
		}()
		select {
		case err := <-written:
			if err != nil {
				t.Fatal(err)
			}
		case err := <-done:
			t.Fatalf("the PUT ended before it read its body: %v", err)
		case <-time.After(5 * time.Second):
			t.Fatal("the PUT does not read its body")
		}
		if err := put(u, id, secret, png); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("a second PUT while the first reads: %v", err)
		}
		if _, _, err := u.Peek(id, "token-a", "photo"); !errors.Is(err, mcp.ErrUploadEmpty) {
			t.Errorf("a peek while the file comes: %v, want it said empty", err)
		}
		if _, err := writer.Write(png[8:]); err != nil {
			t.Fatal(err)
		}
		_ = writer.Close()
		if err := <-done; err != nil {
			t.Fatalf("the first PUT: %v", err)
		}
		if data, _, err := u.Peek(id, "token-a", "photo"); err != nil || !bytes.Equal(data, png) {
			t.Errorf("the file of the first PUT: %d bytes, %v", len(data), err)
		}
	})

	t.Run("a track is read once, at its PUT", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		var parses atomic.Int32
		mcp.SetTrackParseHook(t, func(int) { parses.Add(1) })
		id, secret, _ := u.Open("alice", "token-a", "track")
		if err := put(u, id, secret, testutil.GPX(t, 30)); err != nil {
			t.Fatal(err)
		}
		for range 5 {
			stats, err := u.PeekTrack(id, "token-a")
			if err != nil || stats.Points != 30 {
				t.Fatalf("the track of the slot: %+v, %v", stats, err)
			}
		}
		if _, _, err := u.Take(id, "token-a", "track"); err != nil {
			t.Fatal(err)
		}
		if got := parses.Load(); got != 1 {
			t.Errorf("the track was parsed %d times, want once", got)
		}
	})

	t.Run("a panic while the file comes gives its room back", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		id, secret, _ := u.Open("alice", "token-a", "track")
		func() {
			defer func() {
				if recover() == nil {
					t.Error("the reader's panic did not reach the caller")
				}
			}()
			_ = u.Put(id, secret, -1, readerFunc(func([]byte) (int, error) { panic("a body that fails") }))
		}()
		if u.Bytes() != 0 || u.Len() != 0 {
			t.Errorf("after the panic, %d slots and %d bytes, want none", u.Len(), u.Bytes())
		}
	})

	t.Run("an account keeps 20 Mo at most: its own oldest goes", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		five := photoOf(mcp.PhotoMaxBytes)
		theirs, theirSecret, _ := u.Open("bob", "token-b", "photo")
		if err := put(u, theirs, theirSecret, five); err != nil {
			t.Fatal(err)
		}
		var mine []string
		for i := range 5 {
			token := "token-a" + string(rune('0'+i/2))
			id, secret, _ := u.Open("alice", token, "photo")
			if err := put(u, id, secret, five); err != nil {
				t.Fatalf("photo %d: %v", i+1, err)
			}
			mine = append(mine, id)
		}
		if _, _, err := u.Peek(mine[0], "token-a0", "photo"); !errors.Is(err, mcp.ErrUploadInvalid) {
			t.Errorf("Alice's oldest photo: %v, want it gone", err)
		}
		if _, _, err := u.Peek(theirs, "token-b", "photo"); err != nil {
			t.Errorf("Bob's photo: %v, want it kept", err)
		}
		if want := 5 * mcp.PhotoMaxBytes; u.Bytes() != want {
			t.Errorf("%d bytes kept, want %d", u.Bytes(), want)
		}
	})

	t.Run("slow PUTs: the files of the others stay, and the store says it is full", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		five := photoOf(mcp.PhotoMaxBytes)
		// Bob's four photos, kept.
		var bobs []string
		for i := range 4 {
			token := "token-b" + string(rune('0'+i/2))
			id, secret, _ := u.Open("bob", token, "photo")
			if err := put(u, id, secret, five); err != nil {
				t.Fatal(err)
			}
			bobs = append(bobs, id)
		}
		// Alice holds two chunked tracks open: 20 Mo held for her.
		var writers []*io.PipeWriter
		dones := make(chan error, 2)
		for range 2 {
			id, secret, _ := u.Open("alice", "token-a", "track")
			body, writer := io.Pipe()
			writers = append(writers, writer)
			go func() { dones <- u.Put(id, secret, -1, body) }()
			if _, err := writer.Write([]byte("<?xml")); err != nil {
				t.Fatal(err)
			}
		}
		// A third of hers finds no room of hers to free: busy, and the slot waits.
		id, secret, _ := u.Open("alice", "token-a2", "photo")
		if err := put(u, id, secret, testutil.PNG(t, 8, 8)); !errors.Is(err, mcp.ErrUploadBusy) {
			t.Errorf("a PUT over Alice's room: %v, want busy", err)
		}
		for i, bob := range bobs {
			if _, _, err := u.Peek(bob, "token-b"+string(rune('0'+i/2)), "photo"); err != nil {
				t.Errorf("Bob's photo %d: %v, want it kept", i+1, err)
			}
		}
		for _, writer := range writers {
			_ = writer.Close()
		}
		for range 2 {
			<-dones
		}
		// Once Alice's PUTs are over, the slot that was refused takes its file.
		if err := put(u, id, secret, testutil.PNG(t, 8, 8)); err != nil {
			t.Errorf("the slot refused as busy, afterwards: %v", err)
		}
	})

	t.Run("every byte held by PUTs under way: busy, for any account", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		// Three accounts hold 20 Mo each with chunked tracks: 60 Mo held.
		var writers []*io.PipeWriter
		dones := make(chan error, 6)
		for _, account := range []string{"alice", "bob", "sam"} {
			for range 2 {
				id, secret, _ := u.Open(account, "token-"+account, "track")
				body, writer := io.Pipe()
				writers = append(writers, writer)
				go func() { dones <- u.Put(id, secret, -1, body) }()
				if _, err := writer.Write([]byte("<?xml")); err != nil {
					t.Fatal(err)
				}
			}
		}
		// A fourth account's photo of 5 Mo goes past 64 Mo, and no file can go.
		id, secret, _ := u.Open("admin", "token-admin", "photo")
		if err := put(u, id, secret, photoOf(mcp.PhotoMaxBytes)); !errors.Is(err, mcp.ErrUploadBusy) {
			t.Errorf("a PUT past 64 Mo, all held: %v, want busy", err)
		}
		for _, writer := range writers {
			_ = writer.Close()
		}
		for range 6 {
			<-dones
		}
		if err := put(u, id, secret, photoOf(mcp.PhotoMaxBytes)); err != nil {
			t.Errorf("the slot refused as busy, afterwards: %v", err)
		}
	})

	t.Run("a PUT takes two minutes at most", func(t *testing.T) {
		c := newClock()
		u := mcp.NewUploads(c.now)
		id, secret, _ := u.Open("alice", "token-a", "photo")
		body, writer := io.Pipe()
		done := make(chan error, 1)
		go func() { done <- u.Put(id, secret, -1, body) }()
		if _, err := writer.Write(png[:8]); err != nil {
			t.Fatal(err)
		}
		c.advance(mcp.PutTimeout + time.Second)
		go func() {
			_, _ = writer.Write(png[8:16])
			_ = writer.Close()
		}()
		err := <-done
		_ = body.Close()
		if !errors.Is(err, mcp.ErrUploadTooSlow) {
			t.Errorf("a PUT of more than two minutes: %v, want it cut", err)
		}
		if u.Len() != 0 || u.Bytes() != 0 {
			t.Errorf("then %d slots and %d bytes, want none", u.Len(), u.Bytes())
		}
	})

	t.Run("many at once", func(t *testing.T) {
		u := mcp.NewUploads(newClock().now)
		var wg sync.WaitGroup
		for i := range 20 {
			wg.Go(func() {
				token := "token-" + string(rune('a'+i))
				id, secret, _ := u.Open("someone", token, "photo")
				if err := put(u, id, secret, png); err != nil {
					t.Errorf("put %d: %v", i, err)
				}
				if _, _, err := u.Take(id, token, "photo"); err != nil {
					t.Errorf("take %d: %v", i, err)
				}
			})
		}
		wg.Wait()
		if u.Len() != 0 || u.Bytes() != 0 {
			t.Errorf("%d slots and %d bytes left, want none", u.Len(), u.Bytes())
		}
	})
}

type readerFunc func([]byte) (int, error)

func (f readerFunc) Read(p []byte) (int, error) { return f(p) }

// countingReader counts what is read of r.
type countingReader struct {
	r io.Reader
	n int
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += n
	return n, err
}

// ---------------------------------------------------------------------------
// The route

// slot is what start_upload answered.
type slot struct {
	ID, URL, Secret, Command string
	MaxBytes                 int
}

// startUpload opens a slot through the tool, with token.
func startUpload(t *testing.T, app *tests.TestApp, token, purpose string) slot {
	t.Helper()
	result := succeeded(t, callTool(t, app, token, "start_upload", map[string]any{"purpose": purpose}))
	s := slot{}
	s.ID, _ = result.Structured["upload_id"].(string)
	s.URL, _ = result.Structured["upload_url"].(string)
	s.Secret, _ = result.Structured["secret"].(string)
	s.Command, _ = result.Structured["command"].(string)
	maxBytes, _ := result.Structured["max_bytes"].(float64)
	s.MaxBytes = int(maxBytes)
	if s.ID == "" || s.Secret == "" || s.URL == "" {
		t.Fatalf("start_upload answered %.300s", redact(result.Text))
	}
	return s
}

// path is the path of the address of the slot, which the tests send to.
func (s slot) path(t testing.TB) string {
	t.Helper()
	u, err := url.Parse(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	return u.RequestURI()
}

// putFile sends a PUT to path, with these headers, and checks its status; it
// returns the body of the answer.
func putFile(t *testing.T, app *tests.TestApp, path string, headers map[string]string, body []byte, status int) string {
	t.Helper()
	var text string
	scenario := tests.ApiScenario{
		Method:                http.MethodPut,
		URL:                   path,
		Body:                  bytes.NewReader(body),
		Headers:               headers,
		ExpectedStatus:        status,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			read, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			text = string(read)
		},
	}
	switch status {
	case http.StatusNoContent:
	case http.StatusBadRequest:
		scenario.ExpectedContent = []string{`"code":"upload_invalid"`}
	default:
		scenario.ExpectedContent = []string{`"status":` + strconv.Itoa(status)}
	}
	scenario.Test(t)
	return text
}

// uploaded opens a slot for token and fills it with data: its id.
func uploaded(t *testing.T, app *tests.TestApp, token, purpose string, data []byte) string {
	t.Helper()
	s := startUpload(t, app, token, purpose)
	putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret}, data, http.StatusNoContent)
	return s.ID
}

func TestUploads_Route(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)
	png := testutil.PNG(t, 8, 8)

	t.Run("the right secret, once", func(t *testing.T) {
		s := startUpload(t, app, alice, "photo")
		with := map[string]string{"X-Upload-Secret": s.Secret}
		if !strings.HasPrefix(s.path(t), "/api/app/mcp-uploads/") {
			t.Fatalf("the slot is at %s", s.path(t))
		}
		putFile(t, app, s.path(t), with, png, http.StatusNoContent)
		putFile(t, app, s.path(t), with, png, http.StatusBadRequest)
	})

	t.Run("no secret, a wrong one, or one out of its header", func(t *testing.T) {
		s := startUpload(t, app, alice, "photo")
		for _, row := range []struct {
			name    string
			path    string
			headers map[string]string
		}{
			{"a wrong secret", s.path(t), map[string]string{"X-Upload-Secret": "ptu_" + strings.Repeat("A", 26)}},
			{"the secret of another slot", s.path(t), map[string]string{"X-Upload-Secret": startUpload(t, app, newToken(t, app, fx.Bob), "photo").Secret}},
			{"no header", s.path(t), nil},
			{"the secret in the address", s.path(t) + "?secret=" + url.QueryEscape(s.Secret), nil},
			{"the secret as a bearer", s.path(t), map[string]string{"Authorization": "Bearer " + s.Secret}},
			{"the secret as a cookie", s.path(t), map[string]string{"Cookie": "X-Upload-Secret=" + s.Secret}},
			// A page elsewhere, in a browser: it does not know the secret, and
			// no cookie or session stands for it.
			{"another site, with a session of Alice", s.path(t), map[string]string{"Origin": "https://ailleurs.example", "Authorization": testutil.Token(t, fx.Alice)}},
		} {
			t.Run(row.name, func(t *testing.T) {
				putFile(t, app, row.path, row.headers, png, http.StatusBadRequest)
			})
		}
		// None of them used the slot up.
		putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret}, png, http.StatusNoContent)
	})

	t.Run("a photo of 5 Mo + 1 byte", func(t *testing.T) {
		s := startUpload(t, app, alice, "photo")
		putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret}, photoOf(mcp.PhotoMaxBytes+1), http.StatusRequestEntityTooLarge)
	})

	t.Run("a text for a photo", func(t *testing.T) {
		s := startUpload(t, app, alice, "photo")
		putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret}, []byte("pas une image"), http.StatusBadRequest)
	})

	t.Run("a slot that is not one", func(t *testing.T) {
		putFile(t, app, "/api/app/mcp-uploads/aaaaaaaaaaaaaaa", map[string]string{"X-Upload-Secret": "ptu_" + strings.Repeat("A", 26)}, png, http.StatusBadRequest)
		putFile(t, app, "/api/app/mcp-uploads/pas-un-id", map[string]string{"X-Upload-Secret": "ptu_" + strings.Repeat("A", 26)}, png, http.StatusBadRequest)
	})

	t.Run("a track", func(t *testing.T) {
		s := startUpload(t, app, alice, "track")
		putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret}, testutil.GPX(t, 20), http.StatusNoContent)
	})

	t.Run("as curl sends it: the body is the file, not a form", func(t *testing.T) {
		// curl --data-binary says application/x-www-form-urlencoded: nothing on the
		// way may read the body as a form.
		s := startUpload(t, app, alice, "photo")
		photo := testutil.PNG(t, 40, 30)
		putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret, "Content-Type": "application/x-www-form-urlencoded"}, photo, http.StatusNoContent)
		writeFast(app)
		isDone(t, callTool(t, app, alice, "set_photo", map[string]any{"upload_id": s.ID}))
		name := storedRecord(t, app, "runners", fx.AliceRunner.Id).GetString("avatar")
		if got := served(t, app, pathOf(fileURL("runners", fx.AliceRunner.Id, name)), "image/png"); !bytes.Equal(got, photo) {
			t.Errorf("the photo kept is %d bytes, not the %d sent", len(got), len(photo))
		}
	})
}

// The route has no limit of its own: PocketBase's rule for /api/ (300 requests in
// 10 seconds per address) counts its requests, as it counts any other of the API.
// A secret has 128 bits: what the limit bounds is the noise, not the guessing.
func TestUploads_LimitedByAddress(t *testing.T) {
	app := testutil.NewApp(t)
	wrong := map[string]string{"X-Upload-Secret": "ptu_" + strings.Repeat("A", 26)}
	for range 300 {
		putFile(t, app, "/api/app/mcp-uploads/aaaaaaaaaaaaaaa", wrong, nil, http.StatusBadRequest)
	}
	putFile(t, app, "/api/app/mcp-uploads/aaaaaaaaaaaaaaa", wrong, nil, http.StatusTooManyRequests)
}

// The secret travels in a header: neither the PUTs, good or bad, nor the call of
// start_upload put it in the request log, at the Debug level.
func TestUploads_SecretIsNotLogged(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	app.Settings().Logs.MaxDays = 5
	app.Settings().Logs.MinLevel = int(slog.LevelDebug)
	handler, ok := app.Logger().Handler().(*logger.BatchHandler)
	if !ok {
		t.Fatalf("the logger is a %T, want PocketBase's batch handler", app.Logger().Handler())
	}
	handler.SetLevel(slog.LevelDebug) // what a reload of the settings does
	alice := newToken(t, app, fx.Alice)

	s := startUpload(t, app, alice, "photo")
	wrong := "ptu_" + strings.Repeat("B", 26)
	putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": wrong}, testutil.PNG(t, 8, 8), http.StatusBadRequest)
	putFile(t, app, s.path(t), map[string]string{"X-Upload-Secret": s.Secret}, testutil.PNG(t, 8, 8), http.StatusNoContent)

	// Three requests: start_upload through /mcp, and the two PUTs.
	logs := waitForRequests(t, app, 3)
	var puts []float64
	for _, entry := range logs {
		data, err := json.Marshal(entry.Data)
		if err != nil {
			t.Fatal(err)
		}
		text := entry.Message + " " + string(data)
		for name, secret := range map[string]string{"the secret": s.Secret, "the wrong secret": wrong, "the secret without its prefix": strings.TrimPrefix(s.Secret, "ptu_")} {
			if strings.Contains(text, secret) {
				t.Errorf("the log holds %s (%s) in the entry %q", name, prefix(secret), entry.Message)
			}
		}
		if strings.Contains(text, "ptu_") {
			t.Errorf("the log holds a secret's prefix, in the entry %q", entry.Message)
		}
		if entry.Message == "PUT "+s.path(t) {
			status, _ := entry.Data["status"].(float64)
			puts = append(puts, status)
		}
	}
	// Without them, the checks above would pass on a log without the PUTs.
	if len(puts) != 2 {
		t.Errorf("the log has the PUTs %v, want the 400 and the 204", puts)
	}
}

func TestUploads_AbsentOnTheDemo(t *testing.T) {
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	(&tests.ApiScenario{
		Method:                http.MethodPut,
		URL:                   "/api/app/mcp-uploads/aaaaaaaaaaaaaaa",
		Body:                  bytes.NewReader(testutil.PNG(t, 8, 8)),
		Headers:               map[string]string{"X-Upload-Secret": "ptu_" + strings.Repeat("A", 26)},
		ExpectedStatus:        http.StatusNotFound,
		NotExpectedContent:    []string{"upload_invalid"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// A store that has no room left says so, as a 503 with Retry-After: the slot is
// not used up, and the client tries again later. It is not upload_invalid.
func TestUploads_RouteSaysWhenTheStoreIsFull(t *testing.T) {
	u := mcp.NewUploads(newClock().now)
	// Alice holds her room with two chunked tracks under way.
	var writers []*io.PipeWriter
	dones := make(chan error, 2)
	for range 2 {
		id, secret, _ := u.Open("alice", "token-a", "track")
		body, writer := io.Pipe()
		writers = append(writers, writer)
		go func() { dones <- u.Put(id, secret, -1, body) }()
		if _, err := writer.Write([]byte("<?xml")); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, writer := range writers {
			_ = writer.Close()
		}
		for range 2 {
			<-dones
		}
	}()

	id, secret, _ := u.Open("alice", "token-a2", "photo")
	request := httptest.NewRequest(http.MethodPut, "/api/app/mcp-uploads/"+id, bytes.NewReader(testutil.PNG(t, 8, 8)))
	request.SetPathValue("id", id)
	request.Header.Set("X-Upload-Secret", secret)
	recorder := httptest.NewRecorder()
	e := &core.RequestEvent{}
	e.Request, e.Response = request, recorder
	err := mcp.UploadRoute(u)(e)
	var refused *router.ApiError
	if !errors.As(err, &refused) || refused.Status != http.StatusServiceUnavailable {
		t.Fatalf("a PUT with no room: %v, want a 503", err)
	}
	if got := recorder.Header().Get("Retry-After"); got != "60" {
		t.Errorf("Retry-After = %q, want 60", got)
	}
	if strings.Contains(refused.Message, "upload_invalid") {
		t.Errorf("the refusal says %q", refused.Message)
	}
}
