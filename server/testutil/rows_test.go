package testutil_test

import (
	"bytes"
	"encoding/xml"
	"image"
	"image/png"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core/validators"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/testutil"
)

func refreshURL(testutil.Fixture) string { return "/api/collections/users/auth-refresh" }

// RunRows is exercised on the things the harness itself must get right: what
// runs before the request, who the request is sent as, and what runs after it.
func TestRunRows(t *testing.T) {
	beforeRan, afterRan := false, false

	testutil.RunRows(t, []testutil.Row{
		{
			// Alice does not make her email public in the fixture.
			Name:   "before changes the database before the request",
			As:     "alice",
			Method: http.MethodPost,
			URL:    refreshURL,
			Status: http.StatusOK,
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				beforeRan = true
				user, err := app.FindRecordById("users", fx.Alice.Id)
				if err != nil {
					t.Fatal(err)
				}
				user.SetEmailVisibility(true)
				if err := app.Save(user); err != nil {
					t.Fatal(err)
				}
			},
			Contains: []string{`"emailVisibility":true`},
		},
		{
			Name:   "anon is not signed in",
			As:     "anon",
			Method: http.MethodPost,
			URL:    refreshURL,
			Status: http.StatusUnauthorized,
		},
		{
			Name:     "no As means anon",
			Method:   http.MethodPost,
			URL:      refreshURL,
			Status:   http.StatusUnauthorized,
			Contains: []string{`"status":401`},
		},
		{
			Name:        "alice is signed in as alice",
			As:          "alice",
			Method:      http.MethodPost,
			URL:         refreshURL,
			Status:      http.StatusOK,
			Contains:    []string{`"email":"alice@example.test"`, `"role":"member"`},
			NotContains: []string{"bob@example.test"},
		},
		{
			Name:     "bob is signed in as bob",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      refreshURL,
			Status:   http.StatusOK,
			Contains: []string{`"email":"bob@example.test"`},
		},
		{
			Name:     "admin is signed in as the admin account",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      refreshURL,
			Status:   http.StatusOK,
			Contains: []string{`"email":"admin@example.test"`, `"role":"admin"`},
		},
		{
			// Invitations are created by the routes of the application: the
			// create rule is null, so only superusers can write.
			Name:   "a member cannot create an invitation",
			As:     "alice",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/collections/invitations/records" },
			Body:   func(fx testutil.Fixture) string { return `{"kind":"invite","runner":"` + fx.SamRunner.Id + `"}` },
			Status: http.StatusForbidden,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				afterRan = true
				if n, err := app.CountRecords("invitations"); err != nil || n != 0 {
					t.Errorf("no invitation must exist, got %d (err %v)", n, err)
				}
				if _, err := app.FindRecordById("runners", fx.SamRunner.Id); err != nil {
					t.Errorf("After must see the seeded data: %v", err)
				}
			},
		},
	})

	if !beforeRan {
		t.Error("Row.Before was never called")
	}
	if !afterRan {
		t.Error("Row.After was never called")
	}
}

func TestPNG(t *testing.T) {
	data := testutil.PNG(t, 64, 32)

	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding the image: %v", err)
	}
	if format != "png" || config.Width != 64 || config.Height != 32 {
		t.Errorf("image = %s %dx%d, want png 64x32", format, config.Width, config.Height)
	}
	if _, err := png.Decode(bytes.NewReader(data)); err != nil {
		t.Errorf("the whole image does not decode: %v", err)
	}
}

// GPX is a document that a GPX reader takes for a track: a segment of n points,
// each with a position and an altitude, that goes somewhere and climbs and
// descends. PocketBase must sniff it as application/gpx+xml, the first type of
// the gpx field of the formats, and not as plain XML.
func TestGPX(t *testing.T) {
	data := testutil.GPX(t, 50)

	var doc struct {
		XMLName xml.Name `xml:"gpx"`
		Version string   `xml:"version,attr"`
		Points  []struct {
			Lat float64  `xml:"lat,attr"`
			Lon float64  `xml:"lon,attr"`
			Ele *float64 `xml:"ele"`
		} `xml:"trk>trkseg>trkpt"`
	}
	if err := xml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parsing the document: %v", err)
	}
	if doc.Version != "1.1" || len(doc.Points) != 50 {
		t.Fatalf("document = version %q, %d points; want 1.1, 50", doc.Version, len(doc.Points))
	}
	for i, point := range doc.Points {
		if point.Ele == nil {
			t.Fatalf("point %d has no altitude", i)
		}
		if point.Lat < -90 || point.Lat > 90 || point.Lon < -180 || point.Lon > 180 {
			t.Errorf("point %d is at %v, %v: not a position", i, point.Lat, point.Lon)
		}
	}
	if first, last := doc.Points[0], doc.Points[len(doc.Points)-1]; first.Lat == last.Lat && first.Lon == last.Lon {
		t.Error("the first and the last point are at the same place")
	}
	climbs, descends := false, false
	for i := 1; i < len(doc.Points); i++ {
		switch delta := *doc.Points[i].Ele - *doc.Points[i-1].Ele; {
		case delta > 0:
			climbs = true
		case delta < 0:
			descends = true
		}
	}
	if !climbs || !descends {
		t.Errorf("the altitude climbs %v and descends %v, want both", climbs, descends)
	}

	// What PocketBase checks on an upload is the type that it sniffs.
	file, err := filesystem.NewFileFromBytes(data, "trace.gpx")
	if err != nil {
		t.Fatal(err)
	}
	if err := validators.UploadedFileMimeType([]string{"application/gpx+xml"})(file); err != nil {
		t.Errorf("the document is not sniffed as application/gpx+xml: %v", err)
	}

	// One point is still a track; none is not what the helper is for.
	if got := testutil.GPX(t, 1); !bytes.Contains(got, []byte("<trkpt")) {
		t.Error("a document of one point has no point")
	}
}

func TestImageForm(t *testing.T) {
	data := testutil.PNG(t, 8, 8)
	body, contentType := testutil.ImageForm(t, "avatar", "photo.png", data)

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		t.Fatalf("Content-Type = %q (%v), want multipart/form-data with a boundary", contentType, err)
	}
	part, err := multipart.NewReader(body, params["boundary"]).NextPart()
	if err != nil {
		t.Fatal(err)
	}
	if part.FormName() != "avatar" || part.FileName() != "photo.png" {
		t.Errorf("part = field %q, file %q; want avatar, photo.png", part.FormName(), part.FileName())
	}
	if got, _ := io.ReadAll(part); !bytes.Equal(got, data) {
		t.Error("the file in the form is not the one given")
	}
}

// Form replaces Body, and its Content-Type goes with the request: the server
// can only read the file if it knows the boundary.
func TestRunRows_FormSendsAMultipartBody(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "the multipart body reaches the record",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    func(fx testutil.Fixture) string { return "/api/collections/runners/records/" + fx.SamRunner.Id },
			Form: func(t testing.TB, fx testutil.Fixture) (io.Reader, string) {
				var body bytes.Buffer
				form := multipart.NewWriter(&body)
				if err := form.WriteField("name", "Samantha"); err != nil {
					t.Fatal(err)
				}
				if err := form.Close(); err != nil {
					t.Fatal(err)
				}
				return &body, form.FormDataContentType()
			},
			Status:   http.StatusOK,
			Contains: []string{`"name":"Samantha"`},
		},
	})
}
