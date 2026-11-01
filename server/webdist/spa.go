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
// without a word. The 404 lets the app notice, and reload.
func Register(app core.App, fsys fs.FS) {
	spa := apis.Static(fsys, true)
	files := apis.Static(fsys, false)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/{"+apis.StaticWildcardParam+"...}", func(re *core.RequestEvent) error {
			path := re.Request.PathValue(apis.StaticWildcardParam)
			if reserved(path) {
				return router.NewNotFoundError("", nil)
			}
			if strings.HasPrefix(path, assetsDir) {
				return files(re)
			}
			return spa(re)
		})

		return e.Next()
	})
}

// assetsDir is the directory, without its leading slash, where Vite writes
// the built files.
const assetsDir = "assets/"

// reserved reports whether path, without its leading slash, belongs to
// PocketBase: the API or its dashboard.
func reserved(path string) bool {
	return path == "api" || strings.HasPrefix(path, "api/") ||
		path == "_" || strings.HasPrefix(path, "_/")
}
