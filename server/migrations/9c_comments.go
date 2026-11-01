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
	pbmigrations.Register(upComments, downComments)
}

// commentRules are the rules of "comments": every member reads and writes, and
// only the author changes the text of a comment, and never its author or its
// event. An admin deletes any comment but edits none of the others'. They come
// with the hooks of the comments package, which set the author from the caller,
// pin it and the event on an update, and trim the text.
//
// They are not in accessRules: the rollback of the migration 4 only concerns
// the collections of the migrations 1 to 4.
var commentRules = collectionRules{
	list:   ruleSignedIn,
	view:   ruleSignedIn,
	create: ruleSignedIn,
	update: ruleSignedIn + ` && author.user = @request.auth.id` +
		` && @request.body.author:isset = false && @request.body.event:isset = false`,
	delete: ruleSignedIn + ` && (author.user = @request.auth.id || ` + ruleAdmin + `)`,
}

// upComments creates the comments of an event: who wrote what, and when.
//
//   - A comment goes with its event.
//   - The author is a runner and is not deleted from under a comment: no
//     cascade, so that a runner who wrote one cannot be deleted.
//   - The text is at most 2000 characters, and not blank. A blank text is
//     refused by the hook of the comments package, which trims it before the
//     validation: PocketBase only checks that the text is not empty.
func upComments(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	runners, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return err
	}

	c := core.NewBaseCollection("comments")
	c.Fields.Add(
		cascade(required(relation("event", events))),
		// Set by the server from the signed-in user.
		required(relation("author", runners)),
		&core.TextField{Name: "body", Required: true, Max: 2000},
	)
	// The comments of an event, in the order they were written.
	c.Indexes = types.JSONArray[string]{
		"CREATE INDEX idx_comments_event_created ON comments (event, created)",
	}
	if _, err := saveCollection(app, withTimestamps(c)); err != nil {
		return err
	}
	return setRules(app, "comments", commentRules)
}

// downComments drops the table, and the comments in it.
func downComments(app core.App) error {
	c, err := app.FindCollectionByNameOrId("comments")
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
