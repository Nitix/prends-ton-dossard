package events_test

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/testutil"
)

// gpxOf returns the track file name of F42, "" when it has none.
func gpxOf(t testing.TB, app core.App, id string) string {
	t.Helper()
	record, err := app.FindRecordById("formats", id)
	if err != nil {
		t.Fatal(err)
	}
	return record.GetString("gpx")
}

// withTrace is a Before that gives F42 a track, the way the code of the
// application would.
func withTrace(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	file, err := filesystem.NewFileFromBytes(testutil.GPX(t, 50), "trace.gpx")
	if err != nil {
		t.Fatal(err)
	}
	record, err := app.FindRecordById("formats", fx.F42.Id)
	if err != nil {
		t.Fatal(err)
	}
	record.Set("gpx", file)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if gpxOf(t, app, fx.F42.Id) == "" {
		t.Fatal("the track of F42 was not saved")
	}
}

// withRoute is a Before that gives F42 a link to its route.
func withRoute(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	record, err := app.FindRecordById("formats", fx.F42.Id)
	if err != nil {
		t.Fatal(err)
	}
	record.Set("route_url", "https://www.strava.com/routes/1")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
}

// trackIs asserts whether F42 has a track file after the request.
func trackIs(want bool) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		got := gpxOf(t, app, fx.F42.Id)
		if want && !strings.HasSuffix(got, ".gpx") {
			t.Errorf("the track of F42 is %q, want a .gpx file", got)
		}
		if !want && got != "" {
			t.Errorf("the track of F42 is %q, want none", got)
		}
	}
}

// routeURLIs asserts the stored link to the route of F42.
func routeURLIs(want string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		record, err := app.FindRecordById("formats", fx.F42.Id)
		if err != nil {
			t.Fatal(err)
		}
		if got := record.GetString("route_url"); got != want {
			t.Errorf("route_url = %q, want %q", got, want)
		}
	}
}

// track is a form with these bytes as the gpx file.
func track(name string, data []byte) func(testing.TB, testutil.Fixture) (io.Reader, string) {
	return func(t testing.TB, _ testutil.Fixture) (io.Reader, string) {
		return testutil.ImageForm(t, "gpx", name, data)
	}
}

// The track of a format is its gpx file, and the link to its route a URL. Any
// signed-in member sets them, as they set the other fields of a format, and
// nobody who is not signed in.
func TestFormatRoute(t *testing.T) {
	// A document with a GPX 1.0 namespace, which PocketBase sniffs as plain XML,
	// the way it does most of the GPX files that are not 1.1 or whose root
	// element has too much before the namespace.
	gpx10 := []byte(`<?xml version="1.0"?><gpx version="1.0" creator="x" xmlns="http://www.topografix.com/GPX/1/0">` +
		`<trk><trkseg><trkpt lat="45.9" lon="6.1"><ele>450</ele></trkpt></trkseg></trk></gpx>`)
	plainXML := []byte(`<?xml version="1.0"?><note>pas une trace</note>`)
	noDeclaration := []byte(`<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">` +
		`<trk><trkseg><trkpt lat="45.9" lon="6.1"><ele>450</ele></trkpt></trkseg></trk></gpx>`)
	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	// A track that is exactly the 10 MiB of the field, and one byte more: the
	// document is a real one followed by blanks, which XML lets be, so that
	// the size is the only thing that the field can hold against it.
	padded := func(size int) []byte {
		doc := testutil.GPX(t, 10)
		return append(doc, bytes.Repeat([]byte(" "), size-len(doc))...)
	}

	testutil.RunRows(t, []testutil.Row{
		// gpx
		{
			Name:     "alice sends a GPX track",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Form:     track("trace.gpx", testutil.GPX(t, 50)),
			Status:   http.StatusOK,
			Contains: []string{`"gpx":"trace_`},
			After:    trackIs(true),
		},
		{
			Name:   "bob, who did not create the event, sends a track too",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Form:   track("trace.gpx", testutil.GPX(t, 50)),
			Status: http.StatusOK,
			After:  trackIs(true),
		},
		{
			Name:     "the track is removed with null",
			As:       "alice",
			Before:   withTrace,
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Body:     body(`{"gpx":null}`),
			Status:   http.StatusOK,
			Contains: []string{`"gpx":""`},
			After:    trackIs(false),
		},
		{
			Name:     "a new track replaces the old one",
			As:       "alice",
			Before:   withTrace,
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Form:     track("autre.gpx", testutil.GPX(t, 5)),
			Status:   http.StatusOK,
			Contains: []string{`"gpx":"autre_`},
			After:    trackIs(true),
		},
		{
			Name:     "a PNG is not a track",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Form:     track("trace.gpx", testutil.PNG(t, 16, 16)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("gpx", "validation_invalid_mime_type")},
			After:    trackIs(false),
		},
		{
			Name:   "a file of exactly 10 MiB is accepted",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Form:   track("long.gpx", padded(10<<20)),
			Status: http.StatusOK,
			After:  trackIs(true),
		},
		{
			Name:     "a file of 10 MiB and one byte is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Form:     track("long.gpx", padded(10<<20+1)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("gpx", "validation_file_size_limit")},
			After:    trackIs(false),
		},
		{
			Name:   "a GPX 1.0 file, sniffed as XML, is accepted",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Form:   track("ancienne.gpx", gpx10),
			Status: http.StatusOK,
			After:  trackIs(true),
		},
		{
			// The sniffing only takes a document for XML, hence for a GPX, when it
			// opens with the XML declaration: without it, it is text.
			Name:     "a GPX without its XML declaration is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Form:     track("sans-declaration.gpx", noDeclaration),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("gpx", "validation_invalid_mime_type")},
			After:    trackIs(false),
		},
		{
			Name:     "an SVG, which is XML too, is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Form:     track("image.gpx", svg),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("gpx", "validation_invalid_mime_type")},
			After:    trackIs(false),
		},
		{
			Name:   "any XML file is accepted: the site is the one that reads the track",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Form:   track("note.gpx", plainXML),
			Status: http.StatusOK,
			After:  trackIs(true),
		},
		{
			Name:   "anon cannot send a track",
			As:     "anon",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Form:   track("trace.gpx", testutil.GPX(t, 50)),
			Status: http.StatusNotFound,
			After:  trackIs(false),
		},
		{
			Name:   "anon cannot remove a track",
			As:     "anon",
			Before: withTrace,
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Body:   body(`{"gpx":null}`),
			Status: http.StatusNotFound,
			After:  trackIs(true),
		},
		{
			// The guard of the update rule holds for a form as for JSON.
			Name:   "a track cannot come with a move to another event",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Form: func(t testing.TB, fx testutil.Fixture) (io.Reader, string) {
				var out bytes.Buffer
				form := multipart.NewWriter(&out)
				if err := form.WriteField("event", fx.Event2.Id); err != nil {
					t.Fatal(err)
				}
				part, err := form.CreateFormFile("gpx", "trace.gpx")
				if err != nil {
					t.Fatal(err)
				}
				if _, err := part.Write(testutil.GPX(t, 50)); err != nil {
					t.Fatal(err)
				}
				if err := form.Close(); err != nil {
					t.Fatal(err)
				}
				return &out, form.FormDataContentType()
			},
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				trackIs(false)(t, app, fx)
				record, err := app.FindRecordById("formats", fx.F42.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := record.GetString("event"); got != fx.Event.Id {
					t.Errorf("the event of F42 is %q, want %q", got, fx.Event.Id)
				}
			},
		},

		// route_url
		{
			Name:     "alice sets the link to the route",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Body:     body(`{"route_url":"https://www.strava.com/routes/1"}`),
			Status:   http.StatusOK,
			Contains: []string{`"route_url":"https://www.strava.com/routes/1"`},
			After:    routeURLIs("https://www.strava.com/routes/1"),
		},
		{
			Name:   "the link is emptied",
			As:     "alice",
			Before: withRoute,
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Body:   body(`{"route_url":""}`),
			Status: http.StatusOK,
			After:  routeURLIs(""),
		},
		{
			Name:     "text that is not a URL is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Body:     body(`{"route_url":"pas une url"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("route_url", "validation_invalid_url")},
			After:    routeURLIs(""),
		},
		{
			Name:   "anon cannot set the link",
			As:     "anon",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Body:   body(`{"route_url":"https://www.strava.com/routes/1"}`),
			Status: http.StatusNotFound,
			After:  routeURLIs(""),
		},
		{
			Name:   "a format is created with a link and no track",
			As:     "alice",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: func(fx testutil.Fixture) string {
				return `{"event":"` + fx.Event.Id + `","race_type":"` + fx.Trail.Id +
					`","distance_km":10,"route_url":"https://www.komoot.com/tour/1"}`
			},
			Status:   http.StatusOK,
			Contains: []string{`"route_url":"https://www.komoot.com/tour/1"`, `"gpx":""`},
		},
	})
}

// The field is not protected: the site reads a track with a plain request, and
// a protected file asks for a file token that it would have to renew. The name
// of the file, which no one can guess, is the secret, and the site only shows
// it to signed-in members.
func TestFormatRoute_FileReadableWithoutToken(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	withTrace(t, app, fx)

	format, err := app.FindRecordById("formats", fx.F42.Id)
	if err != nil {
		t.Fatal(err)
	}
	url := "/api/files/" + format.Collection().Id + "/" + format.Id + "/" + format.GetString("gpx")

	scenario := tests.ApiScenario{
		Method:          http.MethodGet,
		URL:             url,
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"<?xml", "<trkpt"},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return app },
		// NewApp already registered the cleanup.
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			// PocketBase asks the browser to download the file rather than show
			// it, which does not matter to the site: it fetches the file and
			// parses the text.
			if got := res.Header.Get("Content-Type"); got != "application/gpx+xml" {
				t.Errorf("Content-Type = %q, want application/gpx+xml", got)
			}
		},
	}
	scenario.Test(t)
}
