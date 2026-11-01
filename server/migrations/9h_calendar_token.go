package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upCalendarToken, downCalendarToken)
}

// upCalendarToken adds the token itself to the calendar link of an account, next
// to its hash, so that the site can show the link again on demand.
//
//   - The hash stays what finds a feed: the route looks the link up by the
//     SHA-256 of the token in the path, as before.
//   - The field is hidden, like the hash, and not required: the links made
//     before the migration have no token, only a hash, and cannot be shown. The
//     member makes a new one. The rules stay null: only the routes of the
//     calendar package read and write the table, so no API response to a member
//     shows a token (a superuser sees the hidden fields).
//   - A copy of the database now holds working links. The table is read by the
//     routes only, and the token only opens the races and the deadlines of its
//     owner (see calendar.Register).
func upCalendarToken(app core.App) error {
	feeds, err := app.FindCollectionByNameOrId("calendar_feeds")
	if err != nil {
		return err
	}
	feeds.Fields.Add(&core.TextField{Name: "token", Hidden: true})
	if err := app.Save(feeds); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}
	return nil
}

// downCalendarToken removes the field, and the tokens it holds. The links stay,
// with their hash, and their feeds go on working; the site can no longer show
// their address.
func downCalendarToken(app core.App) error {
	feeds, err := app.FindCollectionByNameOrId("calendar_feeds")
	if err != nil {
		return err
	}
	feeds.Fields.RemoveByName("token")
	if err := app.Save(feeds); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}
	return nil
}
