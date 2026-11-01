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
)

// feedSuffix ends the last segment of the address of a feed: the calendar apps
// look at the extension to know what they subscribe to.
const feedSuffix = ".ics"

// Register adds the routes of the calendar to app: every member creates,
// replaces and deletes their own link, and a calendar app reads the feed at the
// address of a link.
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
// and the token only opens the races and the deadlines of its owner.
func Register(app core.App, cfg config.Config) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/app/calendar", existsRoute).Bind(apis.RequireAuth("users"))
		e.Router.POST("/api/app/calendar", createRoute(cfg)).Bind(apis.RequireAuth("users"))
		e.Router.DELETE("/api/app/calendar", deleteRoute).Bind(apis.RequireAuth("users"))
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

func existsRoute(e *core.RequestEvent) error {
	count, err := e.App.CountRecords("calendar_feeds", dbx.HashExp{"user": e.Auth.Id})
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"exists": count > 0})
}

// createRoute makes a new token for the account, which replaces the old one: the
// old link stops working. The token is in the response only, once.
func createRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Lang string `json:"lang"`
		}
		// A body that cannot be read leaves the language empty, which the
		// validation of the record refuses.
		_ = e.BindBody(&body)

		token, hash, err := invitations.NewToken()
		if err != nil {
			return e.InternalServerError("", err)
		}
		if err := replaceLink(e.App, e.Auth.Id, hash, body.Lang); err != nil {
			return fail(e, err)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"url": cfg.AppURL + "/api/app/calendar/" + token + feedSuffix,
		})
	}
}

// replaceLink gives the account the link whose token has that hash, in that
// language, in place of the one it has, if any. The language is checked by the
// validation of the record.
func replaceLink(app core.App, userID, hash, lang string) error {
	return app.RunInTransaction(func(tx core.App) error {
		link, err := tx.FindFirstRecordByData("calendar_feeds", "user", userID)
		if errors.Is(err, sql.ErrNoRows) {
			collection, err := tx.FindCollectionByNameOrId("calendar_feeds")
			if err != nil {
				return err
			}
			link = core.NewRecord(collection)
			link.Set("user", userID)
		} else if err != nil {
			return err
		}
		link.Set("token_hash", hash)
		link.Set("lang", lang)
		return tx.Save(link)
	})
}

// deleteRoute deletes the link of the account. An account that has none is not
// an error: it is what the caller wanted.
func deleteRoute(e *core.RequestEvent) error {
	link, err := e.App.FindFirstRecordByData("calendar_feeds", "user", e.Auth.Id)
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

		// An account without a runner has nothing to show: an empty calendar,
		// which a calendar app subscribes to as well as to any other.
		runner, err := events.RunnerOf(e.App, user.Id)
		if err != nil {
			return e.InternalServerError("", err)
		}
		lang := link.GetString("lang")
		var entries []Entry
		if runner != nil {
			if entries, err = entriesOf(e.App, runner, cfg.AppURL, wordsOf(lang)); err != nil {
				return e.InternalServerError("", err)
			}
		}
		return e.Blob(http.StatusOK, "text/calendar; charset=utf-8", []byte(Feed(entries, lang, time.Now())))
	}
}
