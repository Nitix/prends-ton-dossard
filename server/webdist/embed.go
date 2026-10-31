// Package webdist embeds the compiled front end and serves it from the Go
// program, with a fallback to index.html for the client-side routes.
package webdist

import (
	"embed"
	"io/fs"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
)

// The "all:" prefix keeps dist/.gitkeep, the placeholder that lets this
// package compile on a checkout where the front end has not been built yet.
//
//go:embed all:dist
var embedded embed.FS

// Dist returns the compiled front end, rooted at the dist directory that
// "pnpm --dir web build" fills.
func Dist() fs.FS {
	return apis.MustSubFS(embedded, "dist")
}
