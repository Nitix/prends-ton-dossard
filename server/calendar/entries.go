package calendar

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/events"
)

const (
	// uidSuffix ends the UID of every event: they are the ones of this site.
	uidSuffix = "@prends-ton-dossard"
	// statusDNS is the status of a runner who does not start: the feed has
	// nothing for it.
	statusDNS = "dns"
	// statusInterested is the one that a deadline matters for.
	statusInterested = "interested"
)

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
