package events_test

import (
	"reflect"
	"testing"
	"time"

	"courses/server/events"
)

func op(day, tm string, ids ...string) events.Opening {
	return events.Opening{Day: day, Time: tm, FormatIDs: ids}
}

func TestFormatOpening(t *testing.T) {
	tests := []struct {
		name      string
		eventDay  string
		eventTime string
		f         events.FormatOpeningFields
		want      events.Opening
		ok        bool
	}{
		{"day alone takes the event time", "2026-11-16", "12:00", events.FormatOpeningFields{ID: "f", Day: "2026-11-17"}, op("2026-11-17", "12:00", "f"), true},
		{"time alone takes the event day", "2026-11-16", "12:00", events.FormatOpeningFields{ID: "f", Time: "10:00"}, op("2026-11-16", "10:00", "f"), true},
		{"both are its own", "2026-11-16", "12:00", events.FormatOpeningFields{ID: "f", Day: "2026-11-17", Time: "10:00"}, op("2026-11-17", "10:00", "f"), true},
		{"none", "2026-11-16", "12:00", events.FormatOpeningFields{ID: "f"}, events.Opening{}, false},
		{"day alone without an event opening", "", "", events.FormatOpeningFields{ID: "f", Day: "2026-11-17"}, events.Opening{}, false},
		{"time alone without an event day", "", "", events.FormatOpeningFields{ID: "f", Time: "10:00"}, events.Opening{}, false},
		{"equal_to_the_event", "2026-11-16", "12:00", events.FormatOpeningFields{ID: "f", Day: "2026-11-16"}, events.Opening{}, false},
		{"day alone, event without a time", "2026-11-16", "", events.FormatOpeningFields{ID: "f", Day: "2026-11-17"}, op("2026-11-17", "", "f"), true},
		{"day alone on the event day, event without a time", "2026-11-16", "", events.FormatOpeningFields{ID: "f", Day: "2026-11-16"}, events.Opening{}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := events.FormatOpening(tc.eventDay, tc.eventTime, tc.f)
			if ok != tc.ok || (ok && !reflect.DeepEqual(got, tc.want)) {
				t.Errorf("got %+v, %v; want %+v, %v", got, ok, tc.want, tc.ok)
			}
		})
	}
}

var annecy = []events.FormatOpeningFields{
	{ID: "5km", Day: "2026-11-19", Time: "12:00"},
	{ID: "semi", Day: "2026-11-17", Time: "12:00"},
	{ID: "10km", Day: "2026-11-18", Time: "12:00"},
	{ID: "marathon"},
}

func TestGeneralOpening(t *testing.T) {
	o := events.OpeningsOf("", "", annecy)
	tests := []struct {
		name string
		past func(events.Opening) bool
		want events.Opening
	}{
		{"before all", events.PastOnDay("2026-11-15"), op("2026-11-17", "12:00", "semi")},
		{"today is not past", events.PastOnDay("2026-11-17"), op("2026-11-17", "12:00", "semi")},
		{"semi past", events.PastOnDay("2026-11-18"), op("2026-11-18", "12:00", "10km")},
		{"all past: the last", events.PastOnDay("2026-11-20"), op("2026-11-19", "12:00", "5km")},
		{"by the minute", events.PastAt(time.Date(2026, 11, 17, 11, 0, 0, 0, time.UTC)), op("2026-11-18", "12:00", "10km")},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := o.General(tc.past)
			if !ok || !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %+v, %v; want %+v", got, ok, tc.want)
			}
		})
	}

	t.Run("the event's whatever past says", func(t *testing.T) {
		e := events.OpeningsOf("2026-11-16", "12:00", annecy)
		got, ok := e.General(events.PastOnDay("2026-11-30"))
		if !ok || !reflect.DeepEqual(got, op("2026-11-16", "12:00")) {
			t.Errorf("got %+v, %v", got, ok)
		}
	})
	t.Run("same day, by time", func(t *testing.T) {
		e := events.OpeningsOf("", "", []events.FormatOpeningFields{
			{ID: "late", Day: "2026-11-17", Time: "14:00"},
			{ID: "early", Day: "2026-11-17", Time: "09:00"},
		})
		got, ok := e.General(events.PastOnDay("2026-11-01"))
		if !ok || !reflect.DeepEqual(got, op("2026-11-17", "09:00", "early")) {
			t.Errorf("got %+v, %v", got, ok)
		}
	})
	t.Run("none", func(t *testing.T) {
		e := events.OpeningsOf("", "", []events.FormatOpeningFields{{ID: "a"}})
		if got, ok := e.General(events.PastOnDay("2026-11-01")); ok {
			t.Errorf("got %+v, want none", got)
		}
	})
}

func TestOpenings_Of_ForCalendar_Merge(t *testing.T) {
	none := events.PastOnDay("2026-11-15")
	o := events.OpeningsOf("", "", annecy)

	if got, ok := o.Of("semi", none); !ok || !reflect.DeepEqual(got, op("2026-11-17", "12:00", "semi")) {
		t.Errorf("Of(semi) = %+v, %v", got, ok)
	}
	for _, id := range []string{"", "marathon"} {
		want, _ := o.General(none)
		if got, ok := o.Of(id, none); !ok || !reflect.DeepEqual(got, want) {
			t.Errorf("Of(%q) = %+v, %v; want General %+v", id, got, ok, want)
		}
	}

	if got := o.ForCalendar(""); len(got) != 3 || got[0].FormatIDs[0] != "semi" || got[2].FormatIDs[0] != "5km" {
		t.Errorf("ForCalendar(\"\") without an event opening = %+v, want the three by instant", got)
	}
	if got := o.ForCalendar("10km"); !reflect.DeepEqual(got, []events.Opening{op("2026-11-18", "12:00", "10km")}) {
		t.Errorf("ForCalendar(10km) = %+v", got)
	}
	withEvent := events.OpeningsOf("2026-11-16", "12:00", annecy)
	if got := withEvent.ForCalendar(""); !reflect.DeepEqual(got, []events.Opening{op("2026-11-16", "12:00")}) {
		t.Errorf("ForCalendar(\"\") with an event opening = %+v", got)
	}
	if got := withEvent.ForCalendar("marathon"); !reflect.DeepEqual(got, []events.Opening{op("2026-11-16", "12:00")}) {
		t.Errorf("ForCalendar(marathon) = %+v", got)
	}

	got := events.MergeSameInstant([]events.Opening{op("2026-11-17", "12:00", "semi"), op("2026-11-17", "12:00")})
	if !reflect.DeepEqual(got, []events.Opening{op("2026-11-17", "12:00")}) {
		t.Errorf("event + format merge = %+v", got)
	}
	got = events.MergeSameInstant([]events.Opening{op("2026-11-17", "12:00", "b"), op("2026-11-17", "12:00", "a")})
	if !reflect.DeepEqual(got, []events.Opening{op("2026-11-17", "12:00", "a", "b")}) {
		t.Errorf("two formats merge = %+v", got)
	}
	got = events.MergeSameInstant([]events.Opening{op("2026-11-18", "", "x"), op("2026-11-17", "12:00", "y")})
	if len(got) != 2 || got[0].Day != "2026-11-17" {
		t.Errorf("distinct instants = %+v, want both by instant", got)
	}
}

func TestOpenings_Instants(t *testing.T) {
	got, ok := op("2027-03-28", "02:30").Instant()
	want, wantOK := events.OpeningInstant("2027-03-28", "02:30")
	if ok != wantOK || !got.Equal(want) {
		t.Errorf("got %v, %v; want %v, %v", got, ok, want, wantOK)
	}
	if got.UTC().Format("15:04") != "01:30" { // 03:30 Paris summer time
		t.Errorf("02:30 on the day the clocks go forward = %v UTC, want 01:30", got.UTC())
	}
	day, ok := op("2026-11-17", "").Instant()
	if !ok || day.UTC().Format(time.RFC3339) != "2026-11-17T08:00:00Z" {
		t.Errorf("a day alone = %v, %v; want 09:00 Paris", day, ok)
	}
}
