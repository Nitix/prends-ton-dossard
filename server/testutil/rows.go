package testutil

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Row is one API test case, run by RunRows.
type Row struct {
	Name string
	// Before runs once the fixture is seeded and before the request, to put
	// the database in a state that Seed does not create.
	Before func(t testing.TB, app *tests.TestApp, fx Fixture)
	// As is who calls: "anon" (no Authorization header, also the default),
	// "admin", "alice" or "bob" (the token of that fixture account).
	As     string
	Method string
	URL    func(fx Fixture) string
	// Body returns the JSON request body. Leave it nil for no body.
	Body func(fx Fixture) string
	// Form, when given, replaces Body: a multipart body and its Content-Type,
	// for the requests that send a file (see ImageForm).
	Form func(t testing.TB, fx Fixture) (body io.Reader, contentType string)
	// Status is the expected HTTP status.
	Status int
	// Contains and NotContains are texts the response body must, or must not,
	// contain. With neither, the body is not checked, except that a 204 must
	// have none.
	Contains    []string
	NotContains []string
	// After runs once the response is checked, to assert on the database.
	After func(t testing.TB, app *tests.TestApp, fx Fixture)
}

// RunRows runs each row as a subtest on its own application: NewApp, then
// Seed, then the request, so that rows cannot affect one another.
func RunRows(t *testing.T, rows []Row) {
	t.Helper()

	for _, row := range rows {
		t.Run(row.Name, func(t *testing.T) {
			app := NewApp(t)
			fx := Seed(t, app)
			if row.Before != nil {
				row.Before(t, app, fx)
			}

			headers := map[string]string{}
			if user := userFor(t, row.As, fx); user != nil {
				headers["Authorization"] = Token(t, user)
			}

			var body io.Reader
			switch {
			case row.Form != nil:
				var contentType string
				body, contentType = row.Form(t, fx)
				headers["Content-Type"] = contentType
			case row.Body != nil:
				body = strings.NewReader(row.Body(fx))
			}

			notContains := row.NotContains
			if len(row.Contains) == 0 && len(row.NotContains) == 0 && row.Status != http.StatusNoContent {
				// ApiScenario wants an expectation whenever the body is not
				// empty. A text that no JSON body can contain checks nothing.
				notContains = []string{"\x00"}
			}

			scenario := tests.ApiScenario{
				Method:             row.Method,
				URL:                row.URL(fx),
				Body:               body,
				Headers:            headers,
				ExpectedStatus:     row.Status,
				ExpectedContent:    row.Contains,
				NotExpectedContent: notContains,
				TestAppFactory:     func(testing.TB) *tests.TestApp { return app },
				// NewApp already registered the cleanup.
				DisableTestAppCleanup: true,
			}
			if row.After != nil {
				scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
					row.After(t, app, fx)
				}
			}
			scenario.Test(t)
		})
	}
}

// userFor returns the fixture account that as stands for, or nil for anon.
func userFor(t testing.TB, as string, fx Fixture) *core.Record {
	t.Helper()
	switch as {
	case "", "anon":
		return nil
	case "admin":
		return fx.Admin
	case "alice":
		return fx.Alice
	case "bob":
		return fx.Bob
	}
	t.Fatalf("unknown Row.As %q: want anon, admin, alice or bob", as)
	return nil
}

// PNG returns an image/png of the given size, encoded in Go: a gradient, so
// that the file is a real picture and not a blank one.
func PNG(t testing.TB, width, height int) []byte {
	t.Helper()
	if width < 1 || height < 1 {
		t.Fatalf("PNG: a %dx%d image is empty", width, height)
	}

	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x * 255 / width),
				G: uint8(y * 255 / height),
				B: 128,
				A: 255,
			})
		}
	}

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatalf("PNG: encoding: %v", err)
	}
	return out.Bytes()
}

// ImageForm returns a multipart body with one file, data, in the field of that
// name, and its Content-Type (with the boundary): what a browser sends for a
// file input. Pass them as Row.Form.
func ImageForm(t testing.TB, field, filename string, data []byte) (io.Reader, string) {
	t.Helper()

	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile(field, filename)
	if err != nil {
		t.Fatalf("ImageForm: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("ImageForm: %v", err)
	}
	if err := form.Close(); err != nil {
		t.Fatalf("ImageForm: %v", err)
	}
	return &body, form.FormDataContentType()
}

// GPX returns a GPX 1.1 document with one track of one segment of n points,
// each with a position and an altitude: a walk to the north-east of Annecy
// that climbs from 450 m to 750 m in its first half and goes down in the
// second. PocketBase sniffs it as application/gpx+xml, which it does only when
// the root element declares the GPX 1.1 namespace early in the file.
func GPX(t testing.TB, n int) []byte {
	t.Helper()
	if n < 1 {
		t.Fatalf("GPX: a track of %d points is empty", n)
	}

	var out strings.Builder
	out.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	out.WriteString(`<gpx version="1.1" creator="courses tests" xmlns="http://www.topografix.com/GPX/1/1">` + "\n")
	out.WriteString("  <trk>\n    <name>Trace de test</name>\n    <trkseg>\n")
	for i := range n {
		// 0 on the first point and 1 on the last.
		progress := 0.0
		if n > 1 {
			progress = float64(i) / float64(n-1)
		}
		fmt.Fprintf(&out, "      <trkpt lat=\"%.6f\" lon=\"%.6f\"><ele>%.1f</ele></trkpt>\n",
			45.9+0.05*progress, 6.12+0.07*progress, 450+300*math.Sin(math.Pi*progress))
	}
	out.WriteString("    </trkseg>\n  </trk>\n</gpx>\n")
	return []byte(out.String())
}
