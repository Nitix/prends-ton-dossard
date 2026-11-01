package webdist

import (
	"io/fs"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
)

// Register serves fsys on every GET path that no other route handles: a file
// that exists is sent as is, any other path gets index.html so that the
// routes of the single-page app work on a reload or a shared link.
//
// The paths under /api/ and /_/ are never served by it. PocketBase handles
// them (the API and its dashboard), and an unknown one must stay a 404: an API
// client expects JSON, not the HTML of the app.
//
// A missing file under /assets/, where Vite writes the built files, is a 404
// too. Their names change with every build: after a deploy, a tab opened before
// asks for chunks that are gone, and index.html in their place would break it
// without a word. The 404 lets the app notice, and reload. The icons of the
// app, under /icons/, are the same: an image is never HTML.
//
// The service worker script and the manifest are files of the same kind (see
// rootFiles): a 404 when they are missing, and the headers that the browser
// needs when they are there.
//
// A built file that exists is sent with a year-long, immutable Cache-Control
// (see fileDirs). Only a file that exists gets it: a browser that kept a 404
// for a year would not see the chunk again when a rollback brings it back.
func Register(app core.App, fsys fs.FS) {
	spa := apis.Static(fsys, true)
	files := apis.Static(fsys, false)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/{"+apis.StaticWildcardParam+"...}", func(re *core.RequestEvent) error {
			path := re.Request.PathValue(apis.StaticWildcardParam)
			if reserved(path) {
				return router.NewNotFoundError("", nil)
			}
			if headers, ok := rootFiles[path]; ok {
				// Only a file that exists gets its headers: the 404 is
				// JSON, and PocketBase keeps a media type that is already set.
				if _, err := fs.Stat(fsys, path); err != nil {
					return router.NewNotFoundError("", nil)
				}
				for name, value := range headers {
					re.Response.Header().Set(name, value)
				}
				return files(re)
			}
			if headers, ok := fileDirHeaders(path); ok {
				if len(headers) > 0 && isFile(fsys, path) {
					for name, value := range headers {
						re.Response.Header().Set(name, value)
					}
				}
				return files(re)
			}
			return spa(re)
		})

		return e.Next()
	})
}

// fileDirs are the directories, with their trailing slash and without the
// leading one, where only files are served, each with the headers that a file
// that exists there is sent with.
var fileDirs = map[string]map[string]string{
	// The built files that Vite writes. It puts a hash of their content in
	// their names, so a name never serves another content: browsers may keep
	// them for a year.
	"assets/": {"Cache-Control": "public, max-age=31536000, immutable"},
	// The icons (public/icons). Their names carry no hash: a new icon replaces
	// the old one, so they get no header.
	"icons/": nil,
}

// fileDirHeaders reports whether path, without its leading slash, is under one
// of fileDirs, and returns the headers of that directory.
func fileDirHeaders(path string) (map[string]string, bool) {
	for dir, headers := range fileDirs {
		if strings.HasPrefix(path, dir) {
			return headers, true
		}
	}
	return nil, false
}

// isFile reports whether path, without its leading slash, is a file of fsys
// and not a directory.
func isFile(fsys fs.FS, path string) bool {
	info, err := fs.Stat(fsys, path)
	return err == nil && !info.IsDir()
}

// rootFiles are the files at the root that the browser asks for by name, with
// the headers each one is sent with. Without them, a missing file falls back
// to index.html with a 200, and the browser takes the HTML for the file.
var rootFiles = map[string]map[string]string{
	// The browser asks the server again for the script each time it checks
	// for a new version: a copy kept by the HTTP cache would hide a deploy.
	"sw.js": {"Cache-Control": "no-cache"},
	// The media type of a web app manifest. Go does not know .webmanifest.
	"manifest.webmanifest": {"Content-Type": "application/manifest+json"},
}

// reserved reports whether path, without its leading slash, belongs to
// PocketBase: the API or its dashboard.
func reserved(path string) bool {
	return path == "api" || strings.HasPrefix(path, "api/") ||
		path == "_" || strings.HasPrefix(path, "_/")
}
