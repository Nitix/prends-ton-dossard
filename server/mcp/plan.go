package mcp

import (
	"net/http"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/events"
)

// The form of the site, in Go (web/src/features/events/formDraft.ts and
// saveEvent.ts): what a race and its formats are written with, and the end of a
// race, which comes from its formats.

// formatDraft is a format as the form saves it (EventDraft.formats of
// saveEvent.ts): what is not given is "" or 0, as PocketBase stores it. A format
// that has an ID exists already.
type formatDraft struct {
	ID, Name, RaceType, RouteURL, Date        string
	DistanceKm, PriceEur                      float64
	DurationMin, TimeLimitMin, ElevationGainM int
}

// eventDraft is a race as the form saves it (EventDraft of saveEvent.ts).
type eventDraft struct {
	ID, Name, Location, StartDate, EndDate, RegistrationURL, RegistrationDeadline, Notes string
	Formats                                                                              []formatDraft
	Join                                                                                 *joinDraft // creation only
}

// joinDraft is « Je participe » of the form: the owner of the token takes part in
// the format at FormatIndex of eventDraft.Formats, with Status.
type joinDraft struct {
	FormatIndex int
	Status      string
}

// storedEvent is a race as it is stored: its fields and its formats.
type storedEvent struct {
	ID, StartDate, EndDate                                       string
	Name, Location, RegistrationURL, RegistrationDeadline, Notes string
	Formats                                                      []formatDraft
}

// The targets of the operations of a batch, which say what a refused request
// was about (SaveTarget of saveEvent.ts).
const (
	targetEvent         = "event"
	targetFormat        = "format"
	targetRemoval       = "removal"
	targetParticipation = "participation"
)

// batchOp is one request of the batch that saves a race (BatchOp of
// saveEvent.ts), as the batch API of PocketBase reads it.
type batchOp struct {
	Method, URL string
	Body        map[string]any
	Target      string // "event", "format", "removal", "participation"
	Format      int    // index in eventDraft.Formats, -1 otherwise
}

const recordsOf = "/api/collections/"

// eventBody is eventBody of saveEvent.ts: what is not given is sent as "", which
// is also how an update clears a field.
func eventBody(draft eventDraft) map[string]any {
	return map[string]any{
		"name":                  draft.Name,
		"location":              draft.Location,
		"start_date":            draft.StartDate,
		"end_date":              draft.EndDate,
		"registration_url":      draft.RegistrationURL,
		"registration_deadline": draft.RegistrationDeadline,
		"notes":                 draft.Notes,
	}
}

// formatBody is formatBody of saveEvent.ts. The track never goes in a batch: it
// is a file (set_track).
func formatBody(f formatDraft) map[string]any {
	return map[string]any{
		"name":             f.Name,
		"race_type":        f.RaceType,
		"distance_km":      f.DistanceKm,
		"duration_min":     f.DurationMin,
		"time_limit_min":   f.TimeLimitMin,
		"elevation_gain_m": f.ElevationGainM,
		"price_eur":        f.PriceEur,
		"route_url":        f.RouteURL,
		"date":             f.Date,
	}
}

// changedEventBody is the part of eventBody(draft) that differs from the stored
// event: an update sends nothing else (nil when nothing differs).
func changedEventBody(draft eventDraft, stored *storedEvent) map[string]any {
	body := map[string]any{}
	for _, field := range []struct{ name, now, was string }{
		{"name", draft.Name, stored.Name},
		{"location", draft.Location, stored.Location},
		{"start_date", draft.StartDate, stored.StartDate},
		{"end_date", draft.EndDate, stored.EndDate},
		{"registration_url", draft.RegistrationURL, stored.RegistrationURL},
		{"registration_deadline", draft.RegistrationDeadline, stored.RegistrationDeadline},
		{"notes", draft.Notes, stored.Notes},
	} {
		if field.now != field.was {
			body[field.name] = field.now
		}
	}
	if len(body) == 0 {
		return nil
	}
	return body
}

// isInRangeOf is isInRangeOf of saveEvent.ts: whether a day is in the days that
// the stored event has. An empty day is.
func isInRangeOf(stored *storedEvent, day string) bool {
	return day == "" || events.InRange(day, stored.StartDate, stored.EndDate)
}

// planBatch is buildBatch: delete the removed formats, update the kept ones (date only when
// the stored event has that day), update the event, then the late dates and the new formats,
// then the participation of Join. New ids come from core.GenerateDefaultRandomId().
// One difference: a kept format whose fields are all unchanged gets no op, so that a tool
// never writes back stale values over another person's change (spec § 6.5). The
// same goes for the event: its update sends the fields that change, and there is
// none when nothing does. Nothing to write is no op at all.
//
// The server checks the date of a format against the event, and the dates of an
// event against its formats, as they are when each request runs: whatever the
// final state, if it is valid, no request of the batch fails on the way (see
// buildBatch). Without an update of the event, its days do not change, and no
// format waits for them: a draft dated within them is valid as it is stored. A
// format is never sent with its event once it exists.
//
// draft.Join, when set, names a format of draft.Formats, and myRunnerID is the
// runner of the owner of the token: the tool checks both first.
func planBatch(draft eventDraft, stored *storedEvent, myRunnerID string) (ops []batchOp, eventID string, formatIDs []string) {
	switch {
	case stored != nil:
		eventID = stored.ID
	case draft.ID != "":
		eventID = draft.ID
	default:
		eventID = core.GenerateDefaultRandomId()
	}

	storedFormats := map[string]formatDraft{}
	if stored != nil {
		for _, f := range stored.Formats {
			storedFormats[f.ID] = f
		}
	}

	var eventOps []batchOp
	if stored == nil {
		body := eventBody(draft)
		body["id"] = eventID
		eventOps = append(eventOps, batchOp{Method: http.MethodPost, URL: recordsOf + "events/records", Body: body, Target: targetEvent, Format: -1})
	} else if body := changedEventBody(draft, stored); body != nil {
		eventOps = append(eventOps, batchOp{Method: http.MethodPatch, URL: recordsOf + "events/records/" + eventID, Body: body, Target: targetEvent, Format: -1})
	}

	var keptOps, lateOps []batchOp
	for i, f := range draft.Formats {
		id := f.ID
		if id == "" {
			id = core.GenerateDefaultRandomId()
		}
		formatIDs = append(formatIDs, id)
		f.ID = id

		was, exists := storedFormats[id]
		if stored == nil || !exists {
			body := formatBody(f)
			body["id"], body["event"] = id, eventID
			lateOps = append(lateOps, batchOp{Method: http.MethodPost, URL: recordsOf + "formats/records", Body: body, Target: targetFormat, Format: i})
			continue
		}
		// A day that the event does not have yet waits for the event.
		update := recordsOf + "formats/records/" + id
		waits := !isInRangeOf(stored, f.Date)
		sent := f
		if waits {
			sent.Date = ""
		}
		if sent != was {
			keptOps = append(keptOps, batchOp{Method: http.MethodPatch, URL: update, Body: formatBody(sent), Target: targetFormat, Format: i})
		}
		if waits {
			lateOps = append(lateOps, batchOp{Method: http.MethodPatch, URL: update, Body: map[string]any{"date": f.Date}, Target: targetFormat, Format: i})
		}
	}

	var deleteOps []batchOp
	if stored != nil {
		for _, f := range stored.Formats {
			if !slices.Contains(formatIDs, f.ID) {
				deleteOps = append(deleteOps, batchOp{Method: http.MethodDelete, URL: recordsOf + "formats/records/" + f.ID, Target: targetRemoval, Format: -1})
			}
		}
	}

	var joinOps []batchOp
	if draft.Join != nil {
		joinOps = append(joinOps, batchOp{
			Method: http.MethodPost, URL: recordsOf + "participations/records",
			Body: map[string]any{
				"id": core.GenerateDefaultRandomId(), "runner": myRunnerID, "event": eventID,
				"format": formatIDs[draft.Join.FormatIndex], "status": draft.Join.Status,
			},
			Target: targetParticipation, Format: -1,
		})
	}

	ops = slices.Concat(deleteOps, keptOps, eventOps, lateOps, joinOps)
	return ops, eventID, formatIDs
}

// eventEndDate is eventEndDate of formDraft.ts: the last day of an event that
// starts on start, from the days of its formats: the latest of them when it is
// after the start, and none ("") when no format is, which makes the event a
// one-day event. A format that has no day takes place on the first day, so it
// never moves the end; neither does a text that is not a day. Without a start
// day there is no period to speak of.
func eventEndDate(start string, formatDates []string) string {
	if _, ok := events.ParseDay(start); !ok {
		return ""
	}
	end := start
	for _, day := range formatDates {
		if _, ok := events.ParseDay(day); ok && day > end {
			end = day
		}
	}
	if end == start {
		return ""
	}
	return end
}

// longEventDays is LONG_EVENT_DAYS of formDraft.ts: more days than this between
// the first and the last day of an event is more than two weeks, which a year
// typed wrong in the day of a format makes.
const longEventDays = 14

// isLongEvent is isLongEvent of formDraft.ts: whether an event that starts on
// start and ends on end (none is one day) lasts more than two weeks after its
// first day.
func isLongEvent(start, end string) bool {
	from, ok := events.ParseDay(start)
	if !ok {
		return false
	}
	to, ok := events.ParseDay(end)
	if !ok {
		return false
	}
	// Days of UTC: 24 hours each.
	return to.Sub(from) > longEventDays*24*time.Hour
}

// shortens is formerPeriod and shortens of formDraft.ts: whether saving gives
// the stored event (storedStart to storedEnd) an end that is earlier than the one
// it has, or none. An event stored without an end, or with an end that is its
// start (which v4 allowed: one day, as no end is), or with the end that saving
// gives, loses nothing.
func shortens(storedStart, storedEnd, end string) bool {
	if storedEnd == "" || storedEnd == storedStart || storedEnd == end {
		return false
	}
	return end == "" || end < storedEnd
}

// hasMeasure is hasMeasure of formDraft.ts: whether a format has one of its
// three measures, a distance, a duration or a time limit. Zero is none; the
// elevation is not one. The form says so before it sends anything, and the
// server refuses it too (format_measure_required).
func hasMeasure(f formatDraft) bool {
	return f.DistanceKm > 0 || f.DurationMin > 0 || f.TimeLimitMin > 0
}
