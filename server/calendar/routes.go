package calendar

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/config"
	"courses/server/events"
	"courses/server/invitations"
	"courses/server/reminders"
	"courses/server/wording"
)

// feedSuffix ends the last segment of the address of a feed: the calendar apps
// look at the extension to know what they subscribe to.
const feedSuffix = ".ics"

// The kinds of link, and so of feed. An account has one link of each: ScopeMine
// opens the races of the runner of the account, with the deadlines and the
// openings, and ScopeGroup the races where somebody goes, with who goes.
const (
	ScopeMine  = "mine"
	ScopeGroup = "group"
)

// Register adds the routes of the calendar to app: every member creates,
// shows, replaces and deletes their own links, one of each scope, and a calendar app reads the feed
// at the address of a link.
//
// The token of a link is kept, in a hidden field, next to its hash, so that the
// member can be shown the address again. The feed is still found by the hash.
// A link made before the token was kept has only a hash: it works, and its
// address cannot be shown.
//
// The feed is public: the token in its path is the secret. Unlike the links of
// the invitations, which keep their token out of every path, it has to be in
// the path, since a calendar app can only ask for an address. So the route does
// not log the requests that it answers: PocketBase writes the URL of every
// request to its request log, and it would keep a working token in clear text
// for days.
//
// A request that fails is still logged, with its path. A token that is seen in
// such a log can still be a valid one: a path without the .ics suffix, the feed
// of a disabled account, or a 500 all carry it. Only the admins read that log,
// and the token only opens what its link shows: the races and the deadlines of
// its owner, or, for a group link, every race with the names of those who go.
// The two kinds are as secret as each other, and handled the same way.
func Register(app core.App, cfg config.Config) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/app/calendar", existsRoute(cfg)).Bind(apis.RequireAuth("users"))
		e.Router.POST("/api/app/calendar", createRoute(cfg)).Bind(apis.RequireAuth("users"))
		e.Router.DELETE("/api/app/calendar", deleteRoute(cfg)).Bind(apis.RequireAuth("users"))
		// The pattern cannot say "{token}.ics": a wildcard is a whole segment.
		e.Router.GET("/api/app/calendar/{file}", feedRoute(cfg)).Bind(apis.SkipSuccessActivityLog())
		return e.Next()
	})
}

// fail returns err as the response: a refused value is the caller's, and any
// other error is the server's.
func fail(e *core.RequestEvent, err error) error {
	var invalid validation.Errors
	if errors.As(err, &invalid) {
		return err
	}
	return e.InternalServerError("", err)
}

// scopeOf is the scope that a request names: ScopeMine when it names none, the
// scope when it is one, and a refusal on the field scope otherwise, in the code
// that the validation of a record gives.
//
// The group link does not exist on a demo instance (DEMO_LOGIN_EMAIL): the account
// is shared by every visitor, and the link would give the names of the members to
// whoever made it. Its routes answer 404, as the site that has no such feature does.
func scopeOf(cfg config.Config, raw string) (string, error) {
	switch raw {
	case "", ScopeMine:
		return ScopeMine, nil
	case ScopeGroup:
		if cfg.Demo() {
			return "", apperr.New(http.StatusNotFound, apperr.CodeNotFound)
		}
		return ScopeGroup, nil
	}
	return "", apperr.Field("scope", "validation_invalid_value")
}

// linkOf returns the link of the account of that scope, or sql.ErrNoRows.
func linkOf(app core.App, userID, scope string) (*core.Record, error) {
	return app.FindFirstRecordByFilter("calendar_feeds", "user = {:user} && scope = {:scope}",
		dbx.Params{"user": userID, "scope": scope})
}

// today is the day it is in Paris, YYYY-MM-DD: the days of the races are those
// of the wall clock there.
func today(now time.Time) string {
	if paris, err := time.LoadLocation("Europe/Paris"); err == nil {
		now = now.In(paris)
	}
	return now.Format(time.DateOnly)
}

// feedURL is the address of the feed of the link whose token is token.
func feedURL(cfg config.Config, token string) string {
	return cfg.AppURL + "/api/app/calendar/" + token + feedSuffix
}

// existsRoute says whether the account has a link, and its address. The address
// is empty when there is no link, when the link was made before the token was
// kept (only its hash exists, which is no address), and when the token is not
// the one of the hash: the feed is found by the hash, so an address made of
// another token would open nothing.
func existsRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		scope, err := scopeOf(cfg, e.Request.URL.Query().Get("scope"))
		if err != nil {
			return err
		}
		link, err := linkOf(e.App, e.Auth.Id, scope)
		if errors.Is(err, sql.ErrNoRows) {
			return e.JSON(http.StatusOK, map[string]any{"exists": false, "url": ""})
		}
		if err != nil {
			return e.InternalServerError("", err)
		}
		url := ""
		if token := link.GetString("token"); token != "" && invitations.Hash(token) == link.GetString("token_hash") {
			url = feedURL(cfg, token)
		}
		return e.JSON(http.StatusOK, map[string]any{"exists": true, "url": url})
	}
}

// createRoute makes a new token for the account, which replaces the old one: the
// old link stops working. The address is in the response, and it is shown again
// by existsRoute until the next one is made.
func createRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Lang  string `json:"lang"`
			Scope string `json:"scope"`
		}
		// A body that cannot be read leaves the language empty, which the
		// validation of the record refuses.
		_ = e.BindBody(&body)
		scope, err := scopeOf(cfg, body.Scope)
		if err != nil {
			return err
		}

		token, hash, err := invitations.NewToken()
		if err != nil {
			return e.InternalServerError("", err)
		}
		if err := replaceLink(e.App, e.Auth.Id, scope, token, hash, body.Lang); err != nil {
			return fail(e, err)
		}
		return e.JSON(http.StatusOK, map[string]any{"url": feedURL(cfg, token)})
	}
}

// replaceLink gives the account the link whose token is token, and hash its
// hash, in that language, in place of the one it has, if any. The language is
// checked by the validation of the record.
func replaceLink(app core.App, userID, scope, token, hash, lang string) error {
	return app.RunInTransaction(func(tx core.App) error {
		link, err := linkOf(tx, userID, scope)
		if errors.Is(err, sql.ErrNoRows) {
			collection, err := tx.FindCollectionByNameOrId("calendar_feeds")
			if err != nil {
				return err
			}
			link = core.NewRecord(collection)
			link.Set("user", userID)
			link.Set("scope", scope)
		} else if err != nil {
			return err
		}
		link.Set("token", token)
		link.Set("token_hash", hash)
		link.Set("lang", lang)
		return tx.Save(link)
	})
}

// deleteRoute deletes the link of the account of the scope in the query (mine
// without one), and none other. An account that has none is not an error: it is
// what the caller wanted.
func deleteRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		scope, err := scopeOf(cfg, e.Request.URL.Query().Get("scope"))
		if err != nil {
			return err
		}
		link, err := linkOf(e.App, e.Auth.Id, scope)
		if errors.Is(err, sql.ErrNoRows) {
			return e.NoContent(http.StatusNoContent)
		}
		if err != nil {
			return e.InternalServerError("", err)
		}
		if err := e.App.Delete(link); err != nil {
			return e.InternalServerError("", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}

// feedRoute answers the feed of the link whose token is in the path. A token
// that nobody has, a path that does not end with .ics and an account that is
// disabled all give the same 404: disabling an account cuts its feed, and the
// link is back if the account is enabled again.
func feedRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		notFound := apperr.New(http.StatusNotFound, apperr.CodeNotFound)

		token, ok := strings.CutSuffix(e.Request.PathValue("file"), feedSuffix)
		if !ok || token == "" {
			return notFound
		}
		link, err := e.App.FindFirstRecordByData("calendar_feeds", "token_hash", invitations.Hash(token))
		if errors.Is(err, sql.ErrNoRows) {
			return notFound
		}
		if err != nil {
			return e.InternalServerError("", err)
		}
		user, err := e.App.FindRecordById("users", link.GetString("user"))
		if errors.Is(err, sql.ErrNoRows) {
			return notFound
		}
		if err != nil {
			return e.InternalServerError("", err)
		}
		if user.GetBool("disabled") {
			return notFound
		}

		if cfg.Demo() && link.GetString("scope") == ScopeGroup {
			return notFound
		}
		lang := link.GetString("lang")
		w := wording.Of(lang)
		now := time.Now()
		var entries []Entry
		name := "Prends ton dossard"
		if link.GetString("scope") == ScopeGroup {
			// The races where somebody goes, with who: no alarm, since they would
			// ring for races that the person does not run.
			name = w.GroupName()
			if entries, err = groupEntriesOf(e.App, cfg.AppURL, w, today(now)); err != nil {
				return e.InternalServerError("", err)
			}
			return e.Blob(http.StatusOK, "text/calendar; charset=utf-8", []byte(Feed(entries, lang, name, now)))
		}

		// An account without a runner has nothing to show: an empty calendar,
		// which a calendar app subscribes to as well as to any other.
		runner, err := events.RunnerOf(e.App, user.Id)
		if err != nil {
			return e.InternalServerError("", err)
		}
		if runner != nil {
			if entries, err = entriesOf(e.App, runner, cfg.AppURL, w, reminders.Of(user)); err != nil {
				return e.InternalServerError("", err)
			}
		}
		return e.Blob(http.StatusOK, "text/calendar; charset=utf-8", []byte(Feed(entries, lang, name, now)))
	}
}
