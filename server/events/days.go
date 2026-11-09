package events

import "cmp"

// lastDayOrSelf is the last day of the month of a day, or the day itself when it is
// not a real day, so that nothing is made up of it.
func lastDayOrSelf(day string) string {
	if last, ok := LastDayOfMonth(day); ok {
		return last
	}
	return day
}

// LastRaceDay ports lastRaceDay of lib/dates.ts: the day that says whether a race
// is behind and orders it. It is the last day of the month for an event known by
// its month only, otherwise the day of the race (its own, or the start of the
// event).
func LastRaceDay(startDate, formatDate string, monthOnly bool) string {
	if monthOnly {
		return lastDayOrSelf(startDate)
	}
	return cmp.Or(formatDate, startDate)
}

// UpcomingUntil is the last day a participation is still upcoming (the day that is
// compared with today). On a race (onFormat) it is the day of the race, whatever the
// end of its event; on the event alone (no race yet, or supporter) it is the last
// day of the event; a race known by its month only is there until the end of it.
func UpcomingUntil(startDate, endDate, formatDate string, onFormat, monthOnly bool) string {
	switch {
	case monthOnly:
		return lastDayOrSelf(startDate)
	case onFormat:
		return cmp.Or(formatDate, startDate)
	default:
		return cmp.Or(endDate, startDate)
	}
}
