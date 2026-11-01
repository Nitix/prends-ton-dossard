package calendar

import (
	"cmp"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"slices"
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

const (
	// feedSuffix ends the last segment of the address of a feed: the calendar
	// apps look at the extension to know what they subscribe to.
	feedSuffix = ".ics"
	// uidSuffix ends the UID of every event: they are the ones of this site.
	uidSuffix = "@prends-ton-dossard"
	// statusDNS is the status of a runner who does not start: the feed has
	// nothing for it.
	statusDNS = "dns"
	// statusInterested is the one that a deadline matters for.
	statusInterested = "interested"
)

// Register adds the routes of the calendar to app: every member creates,
// replaces and deletes their own link, and a calendar app reads the feed at the
// address of a link.
//
// The feed is public: the token in its path is the secret. Unlike the links of
// the invitations, which keep their token out of every path, it has to be in
// the path, since a calendar app can only ask for an address. So the route does
// not log the requests that it answers: PocketBase writes the URL of every
// request to its request log, and it would keep a working token in clear text
// for days. A request that fails is still logged, and its token gives no access.
// The token only opens the races and the deadlines of its owner.
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

// entriesOf returns the events of the feed of a runner, by first day, then UID,
// so that two readings of the same data give the same file:
//
//   - one for each participation, except those of a race that the runner does
//     not start. A participation in a race is the day of the race (the one of
//     the race, otherwise the first day of the event), and a participation in an
//     event only (interested, supporter) is the days of the event.
//   - one for each event that the runner is interested in, and that has a
//     registration deadline: the day it closes, whether it is over or not, once
//     for the event however many races the runner is interested in.
//
// A day that is not a real one (the hooks of the events do not let one in) is
// left out rather than written: a calendar app refuses the whole file for it.
func entriesOf(app core.App, runner *core.Record, appURL string, w words) ([]Entry, error) {
	participations, err := app.FindAllRecords("participations", dbx.HashExp{"runner": runner.Id})
	if err != nil {
		return nil, err
	}
	if failed := app.ExpandRecords(participations, []string{"event", "format.race_type"}, nil); len(failed) > 0 {
		return nil, fmt.Errorf("expanding the participations: %v", failed)
	}

	var entries []Entry
	closing := map[string]bool{} // the events whose deadline is in the entries
	for _, p := range participations {
		status := p.GetString("status")
		event := p.ExpandedOne("event")
		if status == statusDNS || event == nil {
			continue
		}
		eventURL := appURL + "/evenements/" + event.Id

		if status == statusInterested && !closing[event.Id] {
			closing[event.Id] = true
			if deadline, ok := dayEntry(event.GetString("registration_deadline"), ""); ok {
				entries = append(entries, Entry{
					UID:         "deadline-" + event.Id + "-" + runner.Id + uidSuffix,
					Summary:     w.deadline + separator + event.GetString("name"),
					Description: eventURL,
					URL:         eventURL,
					Start:       deadline.Start,
					End:         deadline.End,
				})
			}
		}

		entry := Entry{
			UID:         "participation-" + p.Id + uidSuffix,
			Summary:     event.GetString("name"),
			Description: w.statusText(status, p.GetBool("confirmed")) + "\n" + eventURL,
			Location:    event.GetString("location"),
			URL:         eventURL,
		}
		var days Entry
		var ok bool
		if format := p.ExpandedOne("format"); format != nil {
			// The day of the race, which is the first of the event when the race
			// has none.
			first := cmp.Or(format.GetString("date"), event.GetString("start_date"))
			days, ok = dayEntry(first, "")
			entry.Summary += separator + w.raceName(
				format.GetString("name"),
				raceTypeLabel(format),
				format.GetFloat("distance_km"),
				format.GetInt("duration_min"),
				format.GetInt("time_limit_min"),
			)
		} else {
			days, ok = dayEntry(event.GetString("start_date"), event.GetString("end_date"))
		}
		if !ok {
			continue
		}
		entry.Start, entry.End = days.Start, days.End
		entries = append(entries, entry)
	}

	slices.SortFunc(entries, func(a, b Entry) int {
		return cmp.Or(cmp.Compare(a.Start, b.Start), cmp.Compare(a.UID, b.UID))
	})
	return entries, nil
}

// raceTypeLabel is the label of the type of a format that was expanded.
func raceTypeLabel(format *core.Record) string {
	if raceType := format.ExpandedOne("race_type"); raceType != nil {
		return raceType.GetString("label")
	}
	return ""
}

// dayEntry returns the first and the day after the last of the days from first
// to last, as the Start and End of an entry. An empty last day, or one before
// the first, is a single day. It reports false for a day that is not real.
func dayEntry(first, last string) (Entry, bool) {
	start, ok := events.ParseDay(first)
	if !ok {
		return Entry{}, false
	}
	end := start
	if day, ok := events.ParseDay(last); ok && day.After(start) {
		end = day
	}
	return Entry{
		Start: start.Format(time.DateOnly),
		End:   end.AddDate(0, 0, 1).Format(time.DateOnly),
	}, true
}
