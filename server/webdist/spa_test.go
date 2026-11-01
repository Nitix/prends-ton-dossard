package webdist_test

import (
	"net/http"
	"testing"
	"testing/fstest"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/webdist"
)

func TestRegister(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":    {Data: []byte(`<div id="root"></div>`)},
		"assets/app.js": {Data: []byte("x")},
	}

	scenarios := []tests.ApiScenario{
		{
			Name:            "a client route falls back to index.html",
			Method:          http.MethodGet,
			URL:             "/liste",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`id="root"`},
		},
		{
			Name:            "a nested client route falls back to index.html",
			Method:          http.MethodGet,
			URL:             "/evenements/abc123/modifier",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`id="root"`},
		},
		{
			// The invitation token travels in the URL fragment, which the
			// browser never sends: the server only sees the bare path.
			Name:            "the invitation route falls back to index.html",
			Method:          http.MethodGet,
			URL:             "/invitation",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`id="root"`},
		},
		{
			Name:            "the root serves index.html",
			Method:          http.MethodGet,
			URL:             "/",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`id="root"`},
		},
		{
			Name:               "an existing file is served as is",
			Method:             http.MethodGet,
			URL:                "/assets/app.js",
			ExpectedStatus:     http.StatusOK,
			ExpectedContent:    []string{"x"},
			NotExpectedContent: []string{`id="root"`},
		},
		{
			// After a deploy, a tab opened before asks for chunks that are
			// gone: index.html in their place would break it in silence. A
			// 404 lets the app notice, and reload (see lib/staleChunks.ts).
			Name:               "a missing file under /assets/ is a 404, not index.html",
			Method:             http.MethodGet,
			URL:                "/assets/old-chunk-1234.js",
			ExpectedStatus:     http.StatusNotFound,
			NotExpectedContent: []string{`id="root"`},
		},
		{
			Name:               "a missing nested file under /assets/ is a 404 too",
			Method:             http.MethodGet,
			URL:                "/assets/fonts/gone.woff2",
			ExpectedStatus:     http.StatusNotFound,
			NotExpectedContent: []string{`id="root"`},
		},
		{
			// Only the directory is reserved: a client route that starts like
			// it is still a route.
			Name:            "a client route that starts with assets falls back to index.html",
			Method:          http.MethodGet,
			URL:             "/assets-de-course",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`id="root"`},
		},
		{
			Name:               "the API keeps its own handlers",
			Method:             http.MethodGet,
			URL:                "/api/health",
			ExpectedStatus:     http.StatusOK,
			ExpectedContent:    []string{`"code":200`},
			NotExpectedContent: []string{`id="root"`},
		},
		{
			// Never the SPA: an API client expects JSON, not HTML.
			Name:               "an unknown API path is a 404, not index.html",
			Method:             http.MethodGet,
			URL:                "/api/app/does-not-exist",
			ExpectedStatus:     http.StatusNotFound,
			ExpectedContent:    []string{`"status":404`},
			NotExpectedContent: []string{`id="root"`},
		},
		{
			Name:               "the bare /api path is a 404, not index.html",
			Method:             http.MethodGet,
			URL:                "/api",
			ExpectedStatus:     http.StatusNotFound,
			ExpectedContent:    []string{`"status":404`},
			NotExpectedContent: []string{`id="root"`},
		},
		{
			// PocketBase serves its dashboard under /_/ when it starts. The
			// router of the tests does not, so only the guard is observable.
			Name:               "the dashboard path is never the SPA",
			Method:             http.MethodGet,
			URL:                "/_/does-not-exist",
			ExpectedStatus:     http.StatusNotFound,
			ExpectedContent:    []string{`"status":404`},
			NotExpectedContent: []string{`id="root"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.TestAppFactory = func(tb testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp(tb.TempDir())
			if err != nil {
				tb.Fatalf("creating the test app: %v", err)
			}
			webdist.Register(app, fsys)
			return app
		}
		scenario.Test(t)
	}
}

func TestDist(t *testing.T) {
	// The embedded directory always holds at least the .gitkeep placeholder,
	// so that go:embed compiles on a fresh checkout. Dist must be rooted at
	// dist/, not above it.
	if _, err := webdist.Dist().Open(".gitkeep"); err != nil {
		t.Fatalf("Dist() is not rooted at dist/: %v", err)
	}
}
