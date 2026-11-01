package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upFormatRoute, downFormatRoute)
}

// formatRouteFields are the fields that the migration adds to the formats, from
// the first to the last.
var formatRouteFields = []string{"gpx", "route_url"}

// upFormatRoute adds the route of a format: its track, a GPX file that the site
// reads in the browser to draw the course and its profile, and a link to the
// route (Strava, Garmin, the page of the race). Neither is required. The rules
// of "formats" stay the ones of the migrations 4 and 9a: any signed-in member
// updates the fields, as they do the others, and nobody else.
//
// The track is not protected, for the reason that the photo of a runner is not
// (9_runner_avatar.go): the site fetches it with a plain request, which cannot
// ask for a file token, and the name of the file is random, so it cannot be
// guessed. The site only shows it to signed-in members.
//
// MimeTypes lists the types that PocketBase can sniff for a GPX file (the
// github.com/gabriel-vasile/mimetype library). It sniffs application/gpx+xml
// when the document opens with an XML declaration and its root element
// declares the GPX 1.1 namespace within the first 512 bytes. Any other document
// that opens with an XML declaration, such as a GPX 1.0 file or a 1.1 one whose
// root element is longer, comes out as text/xml, which the library also knows
// as application/xml. A document without the declaration is text/plain, and is
// refused whatever its namespace. Other kinds of XML have types of their own
// (SVG, XHTML, KML, TCX) and are refused too.
func upFormatRoute(app core.App) error {
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}

	formats.Fields.Add(
		&core.FileField{
			Name:      "gpx",
			MaxSelect: 1,
			MaxSize:   10 << 20,
			MimeTypes: []string{"application/gpx+xml", "application/xml", "text/xml"},
			Protected: false,
		},
		&core.URLField{Name: "route_url"},
	)
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}

// downFormatRoute removes the two fields. The tracks already sent stay in the
// storage directory of PocketBase, unreferenced.
func downFormatRoute(app core.App) error {
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}

	for _, name := range formatRouteFields {
		formats.Fields.RemoveByName(name)
	}
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}
