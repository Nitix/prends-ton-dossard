package events

import (
	"regexp"
	"sync"
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

// parisLocation is the time zone of Paris, loaded once: it does not change, and
// the reminders ask for an instant for every event at every pass.
var parisLocation = sync.OnceValues(func() (*time.Location, error) {
	return time.LoadLocation("Europe/Paris")
})

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
// Two wall times of the year are not one instant, and Go leaves the choice
// unspecified (time.Date): 02:30 on the last Sunday of March does not exist (the
// clocks go from 02:00 to 03:00), and 02:30 on the last Sunday of October is read
// twice (they go from 03:00 back to 02:00). What this gives is what the Go of the
// build gives, which the tests pin: the first is 03:30 summer time, the second the
// later of its two readings, in winter time. Either way the instant is within an
// hour of what the organizers meant, and a person who sets such a time has a
// reminder that comes at one of the two readings.
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
	paris, err := parisLocation()
	if err != nil {
		// The program embeds time/tzdata, so this is a build that does not.
		return time.Time{}, false
	}
	hour := int(hhmm[0]-'0')*10 + int(hhmm[1]-'0')
	minute := int(hhmm[3]-'0')*10 + int(hhmm[4]-'0')
	return time.Date(d.Year(), d.Month(), d.Day(), hour, minute, 0, 0, paris).UTC(), true
}
