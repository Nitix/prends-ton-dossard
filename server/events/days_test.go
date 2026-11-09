package events_test

import (
	"testing"

	"courses/server/events"
)

func TestLastRaceDay(t *testing.T) {
	tests := []struct {
		name          string
		start, format string
		monthOnly     bool
		want          string
	}{
		{"month only", "2027-06-01", "", true, "2027-06-30"},
		{"race with its own day", "2026-11-13", "2026-11-14", false, "2026-11-14"},
		{"race on the start of the event", "2026-11-13", "", false, "2026-11-13"},
		{"month only with a bad day is left alone", "nope", "", true, "nope"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := events.LastRaceDay(tt.start, tt.format, tt.monthOnly); got != tt.want {
				t.Errorf("LastRaceDay = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestUpcomingUntil(t *testing.T) {
	tests := []struct {
		name                string
		start, end, format  string
		onFormat, monthOnly bool
		want                string
	}{
		{"on a race", "2026-11-13", "2026-11-15", "2026-11-13", true, false, "2026-11-13"},
		{"on the event alone, several days", "2026-11-13", "2026-11-15", "", false, false, "2026-11-15"},
		{"on the event alone, one day", "2026-11-13", "", "", false, false, "2026-11-13"},
		{"month only", "2027-02-01", "", "", false, true, "2027-02-28"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := events.UpcomingUntil(tt.start, tt.end, tt.format, tt.onFormat, tt.monthOnly); got != tt.want {
				t.Errorf("UpcomingUntil = %q, want %q", got, tt.want)
			}
		})
	}
}
