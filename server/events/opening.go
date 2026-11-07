package events

import (
	"regexp"
	"time"
)

// DefaultOpeningTime is the time that the site counts for an opening that has a
// day and no time. Registrations open in the morning far more often than at
// night, and a reminder that comes a little early is better than one that comes
// late: 9 h is the guess that the site makes, and the form says that the time
// can be left empty.
const DefaultOpeningTime = "09:00"

// timePattern is a time of the day written HH:MM, from 00:00 to 23:59.
var timePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// ValidTime reports whether s is a time of the day written HH:MM, from 00:00 to
// 23:59. The offers check their time with it too.
func ValidTime(s string) bool {
	return timePattern.MatchString(s)
}

// OpeningInstant is the instant at which registration opens: the day
// (YYYY-MM-DD) at hhmm (HH:MM, or "" for DefaultOpeningTime), Paris time. ok is
// false for a day or a time that is not real.
//
// The opening is kept as civil text, a day and a time of the wall clock of
// Paris, like the other days of the site: that is what the organizers publish
// and what a member reads, and it does not move when the clock changes. An
// instant (UTC) is made here, at the edge, only for what needs one: a reminder
// to send at a given moment, an entry in a calendar.
//
// A wall time that does not exist, such as 02:30 on the last Sunday of March,
// when the clocks go from 02:00 to 03:00, is normalized by Go (03:30, summer
// time), which is the nearest thing that the clock of that day ever showed.
func OpeningInstant(day, hhmm string) (at time.Time, ok bool) {
	d, ok := ParseDay(day)
	if !ok {
		return time.Time{}, false
	}
	if hhmm == "" {
		hhmm = DefaultOpeningTime
	}
	if !ValidTime(hhmm) {
		return time.Time{}, false
	}
	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		// The program embeds time/tzdata, so this is a build that does not.
		return time.Time{}, false
	}
	hour := int(hhmm[0]-'0')*10 + int(hhmm[1]-'0')
	minute := int(hhmm[3]-'0')*10 + int(hhmm[4]-'0')
	return time.Date(d.Year(), d.Month(), d.Day(), hour, minute, 0, 0, paris).UTC(), true
}
