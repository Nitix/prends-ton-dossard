package calendar

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/events"
	"courses/server/reminders"
	"courses/server/wording"
)

const (
	// uidSuffix ends the UID of every event: they are the ones of this site.
	uidSuffix = "@prends-ton-dossard"
	// statusDNS is the status of a runner who does not start: the feed has
	// nothing for it.
	statusDNS = "dns"
	// statusInterested is the one that a deadline matters for.
	statusInterested = "interested"
	// statusRegistered, like statusInterested, matters for an opening: before
	// registrations open, "registered" says an intention or a pre-registration.
	statusRegistered = "registered"
)

// entriesOf returns the events of the feed of a runner, by first day, then UID,
// so that two readings of the same data give the same file:
//
//   - one for each participation, except those of a race that the runner does
//     not start. A participation in a race is the day of the race (the one of
//     the race, otherwise the first day of the event), and a participation in an
//     event only (interested, supporter) is the days of the event.
//
//   - one for each event that the runner is interested in, and that has a
//     registration deadline: the day it closes, whether it is over or not, once
//     for the event however many races the runner is interested in.
//
//   - one for each event that has a registration opening, and that the runner is
//     interested in or registered to, whatever the race: the opening, once for
//     the event, with the alarms that chosen asks for. A supporter does not
//     register, so they have none.
//
// chosen is the choice of the account (reminders.Of): the kinds of alarm that
// an opening has. An empty choice gives openings with no alarm.
//
// A day that is not a real one (the hooks of the events do not let one in) is
// left out rather than written: a calendar app refuses the whole file for it.
func entriesOf(app core.App, runner *core.Record, appURL string, w wording.Words, chosen []string) ([]Entry, error) {
	participations, err := app.FindAllRecords("participations", dbx.HashExp{"runner": runner.Id})
	if err != nil {
		return nil, err
	}
	if failed := app.ExpandRecords(participations, []string{"event", "format.race_type"}, nil); len(failed) > 0 {
		return nil, fmt.Errorf("expanding the participations: %v", failed)
	}

	var entries []Entry
	closing := map[string]bool{} // the events whose deadline is in the entries
	opening := map[string]bool{} // the events whose opening is in the entries
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
					Summary:     w.Deadline() + wording.Separator + event.GetString("name"),
					Description: eventURL,
					URL:         eventURL,
					Start:       deadline.Start,
					End:         deadline.End,
				})
			}
		}

		if (status == statusInterested || status == statusRegistered) && !opening[event.Id] {
			opening[event.Id] = true
			if entry, ok := openingEntry(event, runner, eventURL, w, chosen); ok {
				entries = append(entries, entry)
			}
		}

		entry := Entry{
			UID:         "participation-" + p.Id + uidSuffix,
			Summary:     event.GetString("name"),
			Description: w.StatusText(status, p.GetBool("confirmed")) + "\n" + eventURL,
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
			entry.Summary += wording.Separator + w.RaceName(
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

// openingEntry is the entry of the registration opening of the event for the
// runner, with an alarm for each reminder. It reports false for an event that has
// no opening, or whose day is not a real one.
//
// With a time, the entry is the instant of the opening (Paris time turned into
// UTC, see events.OpeningInstant), and the alarms are relative to it: a day
// before and an hour before. Without one, it is the whole day, and the alarms
// say the moments that the notifications use for such an opening, from the
// start of that day: the day before at 9 h (15 hours before the start) and the
// day itself at 8 h.
func openingEntry(event, runner *core.Record, eventURL string, w wording.Words, chosen []string) (Entry, bool) {
	day, ok := dayEntry(event.GetString("registration_opening"), "")
	if !ok {
		return Entry{}, false
	}
	entry := Entry{
		UID:     "opening-" + event.Id + "-" + runner.Id + uidSuffix,
		Summary: w.Opening() + wording.Separator + event.GetString("name"),
		URL:     eventURL,
		Start:   day.Start,
		End:     day.End,
	}
	entry.Description = eventURL
	if link := event.GetString("registration_url"); link != "" {
		entry.Description = link + "\n" + eventURL
	}

	dayBefore, hourBefore := "-PT15H", "PT8H"
	if hhmm := event.GetString("registration_opening_time"); events.ValidTime(hhmm) {
		if at, ok := events.OpeningInstant(event.GetString("registration_opening"), hhmm); ok {
			entry.At = at
			dayBefore, hourBefore = "-P1D", "-PT1H"
		}
	}
	for _, kind := range chosen {
		switch kind {
		case reminders.KindDay:
			entry.Alarms = append(entry.Alarms, Alarm{Trigger: dayBefore, Description: entry.Summary})
		case reminders.KindHour:
			entry.Alarms = append(entry.Alarms, Alarm{Trigger: hourBefore, Description: entry.Summary})
		}
	}
	return entry, true
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
