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
func Register(app core.App, fsys fs.FS) {
	static := apis.Static(fsys, true)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/{"+apis.StaticWildcardParam+"...}", func(re *core.RequestEvent) error {
			if reserved(re.Request.PathValue(apis.StaticWildcardParam)) {
				return router.NewNotFoundError("", nil)
			}
			return static(re)
		})

		return e.Next()
	})
}

// reserved reports whether path, without its leading slash, belongs to
// PocketBase: the API or its dashboard.
func reserved(path string) bool {
	return path == "api" || strings.HasPrefix(path, "api/") ||
		path == "_" || strings.HasPrefix(path, "_/")
}
