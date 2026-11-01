package comments_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

// record picks a record of the fixture.
type record = func(testutil.Fixture) *core.Record

func event(fx testutil.Fixture) *core.Record       { return fx.Event }
func event2(fx testutil.Fixture) *core.Record      { return fx.Event2 }
func aliceRunner(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
func bobRunner(fx testutil.Fixture) *core.Record   { return fx.BobRunner }

// bobsComment is the comment that Before sets up: Bob wrote it on Event.
var bobsComment *core.Record

// commentURL builds the URL of the comments, or of the one that Before saved.
func commentURL(one bool) func(testutil.Fixture) string {
	return func(testutil.Fixture) string {
		url := "/api/collections/comments/records"
		if one {
			url += "/" + bobsComment.Id
		}
		return url
	}
}

// eventURL builds the URL of an event.
func eventURL(of record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		return "/api/collections/events/records/" + of(fx).Id
	}
}

// body builds a JSON request body, the %q verbs being the ids of the records.
func body(tmpl string, ids ...record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id(fx).Id
		}
		return fmt.Sprintf(tmpl, args...)
	}
}

// fieldError is how the API reports a refused field: data.<field>.code.
func fieldError(field, code string) string {
	return fmt.Sprintf(`"%s":{"code":"%s"`, field, code)
}

// comment saves a comment as the code of the application does, without a
// request: the request hooks do not run, so the author is the one given.
func comment(t testing.TB, app core.App, event, author *core.Record, text string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("comments")
	if err != nil {
		t.Fatal(err)
	}
	c := core.NewRecord(collection)
	c.Set("event", event.Id)
	c.Set("author", author.Id)
	c.Set("body", text)
	if err := app.Save(c); err != nil {
		t.Fatalf("saving a comment: %v", err)
	}
	return c
}

// bobWrote is the Before of the rows that act on a comment of Bob.
func bobWrote(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	bobsComment = comment(t, app, fx.Event, fx.BobRunner, "Qui part de Lyon ?")
}

type check = func(testing.TB, *tests.TestApp, testutil.Fixture)

// storedComments returns every comment in the database.
func storedComments(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	comments, err := app.FindAllRecords("comments")
	if err != nil {
		t.Fatal(err)
	}
	return comments
}

// theOnlyComment returns the one comment in the database, which the request
// has just created.
func theOnlyComment(t testing.TB, app core.App) *core.Record {
	t.Helper()
	comments := storedComments(t, app)
	if len(comments) != 1 {
		t.Fatalf("%d comments in the database, want 1", len(comments))
	}
	return comments[0]
}

// createdIs asserts the author, the event and the text of the only comment,
// which the request has just created.
func createdIs(event, author record, text string) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		c := theOnlyComment(t, app)
		if got, want := c.GetString("event"), event(fx).Id; got != want {
			t.Errorf("event = %q, want %q", got, want)
		}
		if got, want := c.GetString("author"), author(fx).Id; got != want {
			t.Errorf("author = %q, want %q", got, want)
		}
		if got := c.GetString("body"); got != text {
			t.Errorf("body = %q, want %q", got, text)
		}
	}
}

// noComment asserts that the database holds no comment.
func noComment(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
	t.Helper()
	if got := len(storedComments(t, app)); got != 0 {
		t.Errorf("%d comments in the database, want none", got)
	}
}

// commentIs asserts the event and the text of the comment of Bob, whose author
// is Bob whatever happens.
func commentIs(event record, text string) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		c, err := app.FindRecordById("comments", bobsComment.Id)
		if err != nil {
			t.Fatalf("the comment of Bob is not in the database: %v", err)
		}
		if got, want := c.GetString("event"), event(fx).Id; got != want {
			t.Errorf("event = %q, want %q", got, want)
		}
		if got, want := c.GetString("author"), fx.BobRunner.Id; got != want {
			t.Errorf("author = %q, want Bob %q", got, want)
		}
		if got := c.GetString("body"); got != text {
			t.Errorf("body = %q, want %q", got, text)
		}
	}
}

func TestComments(t *testing.T) {
	const bobsText = "Qui part de Lyon ?"

	testutil.RunRows(t, []testutil.Row{
		// Writing.
		{
			Name:     "alice writes: the spaces around the text go",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"event":%q,"body":"  On covoit ?  "}`, event),
			Status:   http.StatusOK,
			Contains: []string{`"body":"On covoit ?"`},
			After:    createdIs(event, aliceRunner, "On covoit ?"),
		},
		{
			Name:   "the author is the runner of the caller, whatever the body says",
			As:     "alice",
			Method: http.MethodPost,
			URL:    commentURL(false),
			Body:   body(`{"event":%q,"author":%q,"body":"x"}`, event, bobRunner),
			Status: http.StatusOK,
			After:  createdIs(event, aliceRunner, "x"),
		},
		{
			Name:   "the lines of a comment stay",
			As:     "bob",
			Method: http.MethodPost,
			URL:    commentURL(false),
			Body:   body(`{"event":%q,"body":"Départ à 6 h\n<b>Gare</b>\n"}`, event),
			Status: http.StatusOK,
			After:  createdIs(event, bobRunner, "Départ à 6 h\n<b>Gare</b>"),
		},
		{
			// The batch route runs the same handlers, so the same hooks.
			Name:   "a batch cannot forge the author, and trims the text too",
			As:     "alice",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/batch" },
			Body: body(`{"requests":[{"method":"POST","url":"/api/collections/comments/records",`+
				`"body":{"event":%q,"author":%q,"body":" Salut "}}]}`, event, bobRunner),
			Status:   http.StatusOK,
			Contains: []string{`"status":200`},
			After:    createdIs(event, aliceRunner, "Salut"),
		},
		{
			Name:   "an anonymous caller cannot write",
			Method: http.MethodPost,
			URL:    commentURL(false),
			Body:   body(`{"event":%q,"body":"x"}`, event),
			Status: http.StatusBadRequest,
			After:  noComment,
		},
		{
			Name:     "a blank text is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"event":%q,"body":"   "}`, event),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("body", "validation_required")},
			After:    noComment,
		},
		{
			Name:     "a text of only line breaks is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"event":%q,"body":" \n\t\n "}`, event),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("body", "validation_required")},
			After:    noComment,
		},
		{
			Name:     "a missing text is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"event":%q}`, event),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("body", "validation_required")},
			After:    noComment,
		},
		{
			Name:   "a text of 2000 characters is kept",
			As:     "alice",
			Method: http.MethodPost,
			URL:    commentURL(false),
			Body:   body(`{"event":%q,"body":"`+strings.Repeat("é", 2000)+`"}`, event),
			Status: http.StatusOK,
			After:  createdIs(event, aliceRunner, strings.Repeat("é", 2000)),
		},
		{
			Name:   "the limit counts the text without the spaces around it",
			As:     "alice",
			Method: http.MethodPost,
			URL:    commentURL(false),
			Body:   body(`{"event":%q,"body":"  `+strings.Repeat("x", 2000)+`  "}`, event),
			Status: http.StatusOK,
			After:  createdIs(event, aliceRunner, strings.Repeat("x", 2000)),
		},
		{
			Name:     "a text of 2001 characters is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"event":%q,"body":"`+strings.Repeat("x", 2001)+`"}`, event),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("body", "validation_max_text_constraint")},
			After:    noComment,
		},
		{
			Name:     "an event is required",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"body":"x"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("event", "validation_required")},
			After:    noComment,
		},

		// Reading.
		{
			Name:   "an anonymous caller lists nothing",
			Before: bobWrote,
			Method: http.MethodGet,
			URL:    commentURL(false),
			Status: http.StatusOK,
			// The comment is there, the rule hides it.
			Contains:    []string{`"items":[]`},
			NotContains: []string{bobsText},
		},
		{
			Name:        "an anonymous caller cannot view one",
			Before:      bobWrote,
			Method:      http.MethodGet,
			URL:         commentURL(true),
			Status:      http.StatusNotFound,
			NotContains: []string{bobsText},
		},
		{
			Name:     "alice lists the comments",
			Before:   bobWrote,
			As:       "alice",
			Method:   http.MethodGet,
			URL:      commentURL(false),
			Status:   http.StatusOK,
			Contains: []string{bobsText},
		},
		{
			Name:     "alice views a comment of bob",
			Before:   bobWrote,
			As:       "alice",
			Method:   http.MethodGet,
			URL:      commentURL(true),
			Status:   http.StatusOK,
			Contains: []string{bobsText},
		},

		// Editing: only the author, and only the text.
		{
			Name:   "alice cannot edit a comment of bob",
			Before: bobWrote,
			As:     "alice",
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"body":"y"}`),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},
		{
			Name:   "bob edits his comment",
			Before: bobWrote,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"body":"y"}`),
			Status: http.StatusOK,
			After:  commentIs(event, "y"),
		},
		{
			Name:   "an edited text loses the spaces around it too",
			Before: bobWrote,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"body":"  y\n"}`),
			Status: http.StatusOK,
			After:  commentIs(event, "y"),
		},
		{
			Name:     "an edit cannot blank the text",
			Before:   bobWrote,
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      commentURL(true),
			Body:     body(`{"body":"  "}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("body", "validation_required")},
			After:    commentIs(event, bobsText),
		},
		{
			Name:   "a comment stays in its event",
			Before: bobWrote,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"event":%q}`, event2),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},
		{
			Name:   "a comment keeps its author",
			Before: bobWrote,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"author":%q}`, aliceRunner),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},
		{
			Name:   "an admin edits no comment but their own",
			Before: bobWrote,
			As:     "admin",
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"body":"y"}`),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},
		{
			Name:   "an anonymous caller edits nothing",
			Before: bobWrote,
			Method: http.MethodPatch,
			URL:    commentURL(true),
			Body:   body(`{"body":"y"}`),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},

		// Deleting: the author, and the admins.
		{
			Name:   "alice cannot delete a comment of bob",
			Before: bobWrote,
			As:     "alice",
			Method: http.MethodDelete,
			URL:    commentURL(true),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},
		{
			Name:   "bob deletes his comment",
			Before: bobWrote,
			As:     "bob",
			Method: http.MethodDelete,
			URL:    commentURL(true),
			Status: http.StatusNoContent,
			After:  noComment,
		},
		{
			Name:   "an admin deletes the comment of a member",
			Before: bobWrote,
			As:     "admin",
			Method: http.MethodDelete,
			URL:    commentURL(true),
			Status: http.StatusNoContent,
			After:  noComment,
		},
		{
			Name:   "an anonymous caller deletes nothing",
			Before: bobWrote,
			Method: http.MethodDelete,
			URL:    commentURL(true),
			Status: http.StatusNotFound,
			After:  commentIs(event, bobsText),
		},

		// The event.
		{
			Name:   "the comments go with their event",
			Before: bobWrote,
			As:     "alice",
			Method: http.MethodDelete,
			URL:    eventURL(event),
			Status: http.StatusNoContent,
			After:  noComment,
		},
		{
			Name: "the comments of another event stay",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				t.Helper()
				bobsComment = comment(t, app, fx.Event2, fx.BobRunner, bobsText)
			},
			As:     "alice",
			Method: http.MethodDelete,
			URL:    eventURL(event),
			Status: http.StatusNoContent,
			After:  commentIs(event2, bobsText),
		},
	})
}

// An account that has no runner is a data error, but it must not let a comment
// through with nobody as its author: the request is refused, whatever author the
// body names.
func TestComments_AccountWithoutRunner(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a caller without a runner has no author",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				t.Helper()
				// The runner of Admin is not deleted when it has an account (the
				// hooks of the accounts package refuse it): it loses the link.
				fx.AdminRunner.Set("user", "")
				if err := app.Save(fx.AdminRunner); err != nil {
					t.Fatal(err)
				}
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      commentURL(false),
			Body:     body(`{"event":%q,"author":%q,"body":"x"}`, event, bobRunner),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("author", "validation_required")},
			After:    noComment,
		},
	})
}

// The text is trimmed by a model hook: it also holds for what the code of the
// application writes, and in a batch request.
func TestComments_ModelHook(t *testing.T) {
	t.Run("a text is trimmed when saved from Go", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		c := comment(t, app, fx.Event, fx.AliceRunner, "\n  Bonjour  \t")

		stored, err := app.FindRecordById("comments", c.Id)
		if err != nil {
			t.Fatal(err)
		}
		if got := stored.GetString("body"); got != "Bonjour" {
			t.Errorf("body = %q, want %q", got, "Bonjour")
		}
	})

	t.Run("a blank text is refused when saved from Go", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		collection, err := app.FindCollectionByNameOrId("comments")
		if err != nil {
			t.Fatal(err)
		}
		c := core.NewRecord(collection)
		c.Set("event", fx.Event.Id)
		c.Set("author", fx.AliceRunner.Id)
		c.Set("body", " \n ")

		err = app.Save(c)
		if err == nil || !strings.Contains(err.Error(), "body") {
			t.Errorf("saving a blank text: error = %v, want one about the body", err)
		}
		if got := len(storedComments(t, app)); got != 0 {
			t.Errorf("%d comments in the database, want none", got)
		}
	})
}

// A comment is never left without its author: the relation has no cascade, so a
// runner who wrote one cannot be deleted. (An account's runner is never deleted
// anyway, and a runner who is on a participation neither: this is the case of a
// runner without account, who has no participation.)
func TestComments_AuthorIsNotDeleted(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	collection, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		t.Fatal(err)
	}
	julie := core.NewRecord(collection)
	julie.Set("name", "Julie")
	if err := app.Save(julie); err != nil {
		t.Fatal(err)
	}
	c := comment(t, app, fx.Event, julie, "Je suis à l'arrivée")

	if err := app.Delete(julie); err == nil {
		t.Error("deleting the author of a comment: want an error")
	}
	if _, err := app.FindRecordById("runners", julie.Id); err != nil {
		t.Errorf("the author is gone: %v", err)
	}
	if _, err := app.FindRecordById("comments", c.Id); err != nil {
		t.Errorf("the comment is gone: %v", err)
	}

	// Once the comment is gone, nothing holds the runner back.
	if err := app.Delete(c); err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(julie); err != nil {
		t.Errorf("deleting a runner without comments: %v", err)
	}
}

// A superuser (the dashboard) goes through the same request hooks, and has no
// runner: the author that it names does not count, and a comment needs one.
func TestComments_Superuser(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	collection, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(collection)
	superuser.SetEmail("root@example.test")
	superuser.SetPassword(testutil.Password)
	if err := app.Save(superuser); err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"Authorization": testutil.Token(t, superuser)}

	scenario := func(method, url, payload string, status int, contains string, after func(testing.TB, *tests.TestApp)) *tests.ApiScenario {
		return &tests.ApiScenario{
			Method:                method,
			URL:                   url,
			Body:                  strings.NewReader(payload),
			Headers:               headers,
			ExpectedStatus:        status,
			ExpectedContent:       []string{contains},
			TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				after(t, app)
			},
		}
	}

	scenario(http.MethodPost, "/api/collections/comments/records",
		fmt.Sprintf(`{"event":%q,"author":%q,"body":"x"}`, fx.Event.Id, fx.BobRunner.Id),
		http.StatusBadRequest, fieldError("author", "validation_required"),
		func(t testing.TB, app *tests.TestApp) {
			if got := len(storedComments(t, app)); got != 0 {
				t.Errorf("%d comments in the database, want none", got)
			}
		}).Test(t)

	// The update rule does not bind a superuser, so the hook is what keeps the
	// author and the event of a comment.
	c := comment(t, app, fx.Event, fx.BobRunner, "Qui part de Lyon ?")
	scenario(http.MethodPatch, "/api/collections/comments/records/"+c.Id,
		fmt.Sprintf(`{"event":%q,"author":%q,"body":"y"}`, fx.Event2.Id, fx.AliceRunner.Id),
		http.StatusOK, `"body":"y"`,
		func(t testing.TB, app *tests.TestApp) {
			got, err := app.FindRecordById("comments", c.Id)
			if err != nil {
				t.Fatal(err)
			}
			if got.GetString("event") != fx.Event.Id || got.GetString("author") != fx.BobRunner.Id || got.GetString("body") != "y" {
				t.Errorf("after the update: event %q, author %q, body %q; want Event, Bob and %q",
					got.GetString("event"), got.GetString("author"), got.GetString("body"), "y")
			}
		}).Test(t)
}
