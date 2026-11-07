package events_test

import (
	"testing"
	"time"

	"courses/server/events"
)

// The opening is Paris wall time: 10:00 is 09:00Z in winter and 08:00Z in
// summer, no time means 9 h, and the hour that does not exist is normalized.
func TestOpeningInstant(t *testing.T) {
	tests := []struct {
		name, day, hhmm string
		want            string // RFC 3339, UTC; "" for not ok
	}{
		{"winter", "2027-01-12", "10:00", "2027-01-12T09:00:00Z"},
		{"summer", "2027-07-12", "10:00", "2027-07-12T08:00:00Z"},
		{"no time counts 9 h", "2027-01-12", "", "2027-01-12T08:00:00Z"},
		{"the hour that does not exist", "2027-03-28", "02:30", "2027-03-28T01:30:00Z"},
		{"midnight", "2027-01-12", "00:00", "2027-01-11T23:00:00Z"},
		{"a day that is not real", "2027-02-31", "10:00", ""},
		{"a day that is not a day", "12/01/2027", "10:00", ""},
		{"no day", "", "10:00", ""},
		{"24:00", "2027-01-12", "24:00", ""},
		{"9:00", "2027-01-12", "9:00", ""},
		{"10h", "2027-01-12", "10h", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			at, ok := events.OpeningInstant(tt.day, tt.hhmm)
			if tt.want == "" {
				if ok {
					t.Errorf("OpeningInstant(%q, %q) = %v, true; want not ok", tt.day, tt.hhmm, at)
				}
				return
			}
			if !ok {
				t.Fatalf("OpeningInstant(%q, %q) is not ok, want %s", tt.day, tt.hhmm, tt.want)
			}
			if got := at.Format(time.RFC3339); got != tt.want {
				t.Errorf("OpeningInstant(%q, %q) = %s, want %s", tt.day, tt.hhmm, got, tt.want)
			}
		})
	}
}

func TestValidTime(t *testing.T) {
	for _, s := range []string{"00:00", "09:05", "23:59"} {
		if !events.ValidTime(s) {
			t.Errorf("ValidTime(%q) = false", s)
		}
	}
	for _, s := range []string{"", "24:00", "9:00", "10h", "12:60", "12:5", " 12:00"} {
		if events.ValidTime(s) {
			t.Errorf("ValidTime(%q) = true", s)
		}
	}
}
