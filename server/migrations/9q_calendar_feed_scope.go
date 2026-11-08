package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upCalendarFeedScope, downCalendarFeedScope)
}

// upCalendarFeedScope adds calendar_feeds.scope: which feed a link opens, "mine"
// (the races of the runner of the account) or "group" (every race where somebody
// goes).
//
//   - The links that exist become "mine": they are the personal feed, and go on
//     working at the same address. The field is added optional, the rows are
//     given their value, and only then is it made required, so that no save
//     meets a required field that is empty.
//   - An account has one link of each kind, not one: the unique index on the user
//     becomes one on the user and the scope. Making a new link of a kind replaces
//     the old one of that kind and leaves the other.
//   - The rules stay null, and the token of a group link is as secret as the
//     personal one (hidden, hashed to be found, shown only by the routes). It
//     opens more: the names of the members.
func upCalendarFeedScope(app core.App) error {
	feeds, err := app.FindCollectionByNameOrId("calendar_feeds")
	if err != nil {
		return err
	}
	feeds.Fields.Add(&core.SelectField{Name: "scope", Values: []string{"mine", "group"}, MaxSelect: 1})
	if err := app.Save(feeds); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}

	if _, err := app.DB().NewQuery("UPDATE calendar_feeds SET scope = 'mine'").Execute(); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}

	feeds, err = app.FindCollectionByNameOrId("calendar_feeds")
	if err != nil {
		return err
	}
	feeds.Fields.Add(&core.SelectField{Name: "scope", Values: []string{"mine", "group"}, MaxSelect: 1, Required: true})
	feeds.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_calendar_feeds_user_scope ON calendar_feeds (user, scope)",
	}
	if err := app.Save(feeds); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}
	return nil
}

// downCalendarFeedScope deletes the group links (the index of 9g allows one link
// per account, and a group link is not a personal one), removes the field, and
// puts the index of 9g back. The personal links stay and go on working.
func downCalendarFeedScope(app core.App) error {
	feeds, err := app.FindCollectionByNameOrId("calendar_feeds")
	if err != nil {
		return err
	}
	if feeds.Fields.GetByName("scope") == nil {
		return nil // already rolled back
	}
	if _, err := app.DB().NewQuery("DELETE FROM calendar_feeds WHERE scope = 'group'").Execute(); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}
	feeds.Fields.RemoveByName("scope")
	feeds.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_calendar_feeds_user ON calendar_feeds (user)",
	}
	if err := app.Save(feeds); err != nil {
		return fmt.Errorf("calendar_feeds: %w", err)
	}
	return nil
}
