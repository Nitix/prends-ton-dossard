package migrations

import (
	"database/sql"
	"errors"
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upCalendarFeeds, downCalendarFeeds)
}

// upCalendarFeeds creates the calendar link of an account: the address that a
// calendar app subscribes to, to show the races and the deadlines of the
// runner of the account.
//
//   - A link goes with its account. An account has one: a new link replaces the
//     old, which then stops working.
//   - Only the SHA-256 of the token is kept, as for the invitations, and the
//     field is hidden: a copy of the database gives no working link.
//   - The language is the one of the texts of the feed. It is a select, so that
//     the routes of the calendar package get its validation, and its error
//     codes, by saving a record.
//   - All the rules are null (the collection is created with them): only the
//     routes of the calendar package read and write the table, so that the
//     collection API never shows the hash of a token.
func upCalendarFeeds(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	c := core.NewBaseCollection("calendar_feeds")
	c.Fields.Add(
		cascade(required(relation("user", users))),
		&core.TextField{Name: "token_hash", Required: true, Hidden: true},
		&core.SelectField{Name: "lang", Values: []string{"fr", "en"}, MaxSelect: 1, Required: true},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_calendar_feeds_user ON calendar_feeds (user)",
	}
	_, err = saveCollection(app, withTimestamps(c))
	return err
}

// downCalendarFeeds drops the table, and the links in it: the calendar apps
// that were subscribed get a 404.
func downCalendarFeeds(app core.App) error {
	c, err := app.FindCollectionByNameOrId("calendar_feeds")
	if errors.Is(err, sql.ErrNoRows) {
		return nil // already gone
	}
	if err != nil {
		return err
	}
	if err := app.Delete(c); err != nil {
		return fmt.Errorf("%s: %w", c.Name, err)
	}
	return nil
}
