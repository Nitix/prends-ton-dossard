package events

import (
	"cmp"
	"slices"
	"sort"
	"time"
)

// Opening is one registration opening: a day, an optional time (Paris wall
// clock, "" counts as DefaultOpeningTime) and its source. FormatIDs is empty
// for the opening of the event itself, and holds the sorted ids of the formats
// that have it otherwise. It is the Go port of features/events/opening.ts: the
// reminders, the calendar feed and the MCP must answer what the site answers.
type Opening struct {
	Day       string
	Time      string
	FormatIDs []string
}

// Instant is the instant of the opening (OpeningInstant); ok is false when the
// day or the time is not real.
func (o Opening) Instant() (time.Time, bool) {
	return OpeningInstant(o.Day, o.Time)
}

// FormatOpeningFields is a format's id and its stored registration_opening and
// registration_opening_time.
type FormatOpeningFields struct {
	ID, Day, Time string
}

// FormatOpening is the opening of a format. A day and a time are its own; a day
// alone takes the time of the event's opening, a time alone its day. A partial
// value needs the event to have its own opening (eventDay != ""), as the part
// that is missing never comes from a general opening drawn from the formats.
// A result at the very instant of the event's opening is the event's, not the
// format's: ok is false, so that there is no second line and no second reminder.
func FormatOpening(eventDay, eventTime string, f FormatOpeningFields) (Opening, bool) {
	if f.Day == "" && f.Time == "" {
		return Opening{}, false
	}
	day, tm := f.Day, f.Time
	if day == "" || tm == "" {
		if eventDay == "" {
			return Opening{}, false
		}
		if day == "" {
			day = eventDay
		} else {
			tm = eventTime
		}
	}
	o := Opening{Day: day, Time: tm, FormatIDs: []string{f.ID}}
	if eventDay != "" {
		if own, ok := OpeningInstant(eventDay, eventTime); ok {
			if at, ok := o.Instant(); ok && at.Equal(own) {
				return Opening{}, false
			}
		}
	}
	return o, true
}

// EventOpenings are the openings of one event: its own, and those of its
// formats that have one apart from the event's.
type EventOpenings struct {
	Event   *Opening
	Formats map[string]Opening
}

// OpeningsOf gathers the openings of an event from its own day and time and
// from its formats' fields.
func OpeningsOf(eventDay, eventTime string, formats []FormatOpeningFields) EventOpenings {
	e := EventOpenings{Formats: map[string]Opening{}}
	if eventDay != "" {
		e.Event = &Opening{Day: eventDay, Time: eventTime}
	}
	for _, f := range formats {
		if o, ok := FormatOpening(eventDay, eventTime, f); ok {
			e.Formats[f.ID] = o
		}
	}
	return e
}

// byInstant lists the openings that have an instant, earliest first, the first
// format id breaking a tie (the event's own, with no id, comes first).
func byInstant(openings []Opening) []Opening {
	type timed struct {
		at time.Time
		o  Opening
	}
	var ts []timed
	for _, o := range openings {
		if at, ok := o.Instant(); ok {
			ts = append(ts, timed{at, o})
		}
	}
	firstID := func(o Opening) string {
		if len(o.FormatIDs) == 0 {
			return ""
		}
		return o.FormatIDs[0]
	}
	sort.SliceStable(ts, func(i, j int) bool {
		if !ts[i].at.Equal(ts[j].at) {
			return ts[i].at.Before(ts[j].at)
		}
		return firstID(ts[i].o) < firstID(ts[j].o)
	})
	out := make([]Opening, len(ts))
	for i, t := range ts {
		out[i] = t.o
	}
	return out
}

func (e EventOpenings) formatOpenings() []Opening {
	all := make([]Opening, 0, len(e.Formats))
	for _, o := range e.Formats {
		all = append(all, o)
	}
	return byInstant(all)
}

// General is the opening of the event: its own whatever past says; else, among
// the formats' openings, the first not past (the next to come), else the last
// one (registrations are open). ok is false with no opening at all.
func (e EventOpenings) General(past func(Opening) bool) (Opening, bool) {
	if e.Event != nil {
		return *e.Event, true
	}
	all := e.formatOpenings()
	if len(all) == 0 {
		return Opening{}, false
	}
	for _, o := range all {
		if !past(o) {
			return o, true
		}
	}
	return all[len(all)-1], true
}

// Of is the opening that counts for a format: its own, else General.
func (e EventOpenings) Of(formatID string, past func(Opening) bool) (Opening, bool) {
	if o, ok := e.Formats[formatID]; ok {
		return o, true
	}
	return e.General(past)
}

// ForCalendar is the opening(s) a calendar holds for a format: its own; else the
// event's; else every format opening, because a calendar does not depend on the
// moment it is read and the general opening will take them one after the other.
func (e EventOpenings) ForCalendar(formatID string) []Opening {
	if o, ok := e.Formats[formatID]; ok {
		return []Opening{o}
	}
	if e.Event != nil {
		return []Opening{*e.Event}
	}
	return e.formatOpenings()
}

// MergeSameInstant keeps one opening per instant, earliest first: the event's
// (no FormatIDs) if one of them is, else the sorted union of the format ids.
func MergeSameInstant(openings []Opening) []Opening {
	var out []Opening
	var lastAt time.Time
	for _, o := range byInstant(openings) {
		at, _ := o.Instant()
		if n := len(out); n > 0 && at.Equal(lastAt) {
			prev := &out[n-1]
			// The same instant can be written with or without a time (a day alone counts
			// 09:00): keep the one that is written, whatever the ids.
			written := cmp.Or(prev.Time, o.Time)
			if len(prev.FormatIDs) == 0 {
				prev.Time = written
				continue
			}
			if len(o.FormatIDs) == 0 {
				*prev = Opening{Day: o.Day, Time: written}
				continue
			}
			prev.Time = written
			ids := slices.Concat(prev.FormatIDs, o.FormatIDs)
			slices.Sort(ids)
			prev.FormatIDs = slices.Compact(ids)
			continue
		}
		o.FormatIDs = slices.Clone(o.FormatIDs)
		out = append(out, o)
		lastAt = at
	}
	return out
}

// PastOnDay counts an opening as past once its day is before today (YYYY-MM-DD):
// the day of the opening is still "today", as on the site.
func PastOnDay(today string) func(Opening) bool {
	return func(o Opening) bool { return o.Day < today }
}

// PastAt counts an opening as past once its instant is not after at (reminders).
func PastAt(at time.Time) func(Opening) bool {
	return func(o Opening) bool {
		t, ok := o.Instant()
		return ok && !t.After(at)
	}
}
