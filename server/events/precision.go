package events

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// PrecisionMonth is events.date_precision of an event known by its month only
// ("juin 2027"); any other value, or none, is a race with a day (see
// migrations/9p_event_date_precision.go).
const PrecisionMonth = "month"

// MonthOnly reports whether the date of the event is known by its month only.
// Such an event runs from the 1st to the last day of that month, and its
// formats have no date.
func MonthOnly(event *core.Record) bool {
	return event.GetString("date_precision") == PrecisionMonth
}

// LastDayOfMonth is the last day of the month that a day (YYYY-MM-DD) is in:
// "2027-06-01" gives "2027-06-30". It reports false for a text that is not a
// real day.
func LastDayOfMonth(day string) (string, bool) {
	d, ok := ParseDay(day)
	if !ok {
		return "", false
	}
	return d.AddDate(0, 1, -d.Day()).Format(dayLayout), true
}

// isFirstOfMonth reports whether day is the 1st of its month.
func isFirstOfMonth(day string) bool {
	d, ok := ParseDay(day)
	return ok && d.Day() == 1
}
