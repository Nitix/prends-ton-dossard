// Package comments holds the hooks that keep the comments of an event true:
// who wrote one, what it says, and where it stays.
//
// The author comes from the request, so it is set by request hooks, as the
// creator of an event is. That the text is not blank is an invariant of the
// data, so it is a model hook: it also covers the writes that do not come from
// the API (the code of the application, a batch request).
package comments

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/events"
)

// Register attaches the hooks of the comments collection to app.
func Register(app core.App) {
	app.OnRecordCreateRequest("comments").BindFunc(func(e *core.RecordRequestEvent) error {
		// Whatever the request says, the author is the runner of the caller. A
		// superuser, or an account without a runner, has none: the comment is
		// then refused by the validation, which requires an author.
		author := ""
		if e.Auth != nil && !e.HasSuperuserAuth() {
			runner, err := events.RunnerOf(e.App, e.Auth.Id)
			if err != nil {
				return e.InternalServerError("", err)
			}
			if runner != nil {
				author = runner.Id
			}
		}
		e.Record.Set("author", author)
		return e.Next()
	})

	app.OnRecordUpdateRequest("comments").BindFunc(func(e *core.RecordRequestEvent) error {
		// The update rule already refuses a body that names them. This is what
		// keeps them for the callers that the rule does not bind (a superuser).
		for _, field := range []string{"author", "event"} {
			e.Record.Set(field, e.Record.Original().GetString(field))
		}
		return e.Next()
	})

	// The text loses the spaces and the line breaks around it before the system
	// validation, which then refuses a text that is empty, or that was made of
	// spaces only (it requires a value, and "   " is one), and counts the limit
	// on what is kept.
	app.OnRecordValidate("comments").BindFunc(func(e *core.RecordEvent) error {
		e.Record.Set("body", strings.TrimSpace(e.Record.GetString("body")))
		return e.Next()
	})
}
