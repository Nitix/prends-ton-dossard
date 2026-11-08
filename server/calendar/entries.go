package calendar

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
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
		monthOnly := events.MonthOnly(event)
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
			// A race known by its month is the 1st alone, not the whole month.
			end := event.GetString("end_date")
			if monthOnly {
				end = ""
			}
			days, ok = dayEntry(event.GetString("start_date"), end)
		}
		if !ok {
			continue
		}
		entry.Start, entry.End = days.Start, days.End
		if monthOnly {
			// The day is not known: the 1st reminds of the race, and the file
			// says so. The UID stays, so the calendar moves the race to its day
			// once it is known.
			entry.Summary += " (" + w.DateToBeSet() + ")"
		}
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

// groupHorizon is how far back the group feed goes: a race whose last day is more
// than this many days before today is left out.
const groupHorizon = 365

// statusSupporter is the status of someone who comes to support.
const statusSupporter = "supporter"

// groupEntriesOf returns the events of the group feed: one for each event whose
// last day is at most groupHorizon days before today (YYYY-MM-DD, Paris) and that
// has at least one participation other than "dns", by first day, then UID.
//
// The description says who goes, a line for each race that somebody is in, then
// the line of those interested who have not chosen a race, the line of the
// supporters, and the address of the event. Those who do not start are nowhere,
// and so is an event that only they are in. The feed has no opening, no deadline
// and no alarm: they are in the personal feed, which knows who they matter to.
//
// A race known by its month is the 1st alone, with "(date à préciser)", as in the
// personal feed. A day that is not a real one is left out, as there.
//
// The names are those of the members, and the lines are text: the feed escapes
// them as it does every value, and a name is written on one line, whatever it holds.
func groupEntriesOf(app core.App, appURL string, w wording.Words, today string) ([]Entry, error) {
	now, ok := events.ParseDay(today)
	if !ok {
		return nil, fmt.Errorf("today is not a day: %q", today)
	}
	oldest := now.AddDate(0, 0, -groupHorizon).Format(time.DateOnly)

	participations, err := app.FindAllRecords("participations", dbx.NewExp("status != {:dns}", dbx.Params{"dns": statusDNS}))
	if err != nil {
		return nil, err
	}
	if failed := app.ExpandRecords(participations, []string{"event", "runner", "format.race_type"}, nil); len(failed) > 0 {
		return nil, fmt.Errorf("expanding the participations: %v", failed)
	}

	// who is one person going to an event, as the description names them.
	type who struct {
		sortKey, id, text string
	}
	// race is one race of an event, with those who are in it.
	type race struct {
		first, name, id string
		people          []who
	}
	// gathering is what the description of an event is made of.
	type gathering struct {
		event      *core.Record
		races      map[string]*race
		undecided  []who
		supporters []who
	}
	byEvent := map[string]*gathering{}

	for _, p := range participations {
		event, runner := p.ExpandedOne("event"), p.ExpandedOne("runner")
		if event == nil || runner == nil {
			continue
		}
		if last := cmp.Or(event.GetString("end_date"), event.GetString("start_date")); last < oldest {
			continue
		}
		g := byEvent[event.Id]
		if g == nil {
			g = &gathering{event: event, races: map[string]*race{}}
			byEvent[event.Id] = g
		}

		name := strings.Join(strings.Fields(runner.GetString("name")), " ")
		person := who{sortKey: wording.Fold(name), id: p.Id, text: name}
		status := p.GetString("status")
		format := p.ExpandedOne("format")
		switch {
		case status == statusSupporter:
			g.supporters = append(g.supporters, person)
		case format == nil:
			g.undecided = append(g.undecided, person)
		default:
			r := g.races[format.Id]
			if r == nil {
				r = &race{
					id:    format.Id,
					first: cmp.Or(format.GetString("date"), event.GetString("start_date")),
					name: w.RaceName(
						format.GetString("name"),
						raceTypeLabel(format),
						format.GetFloat("distance_km"),
						format.GetInt("duration_min"),
						format.GetInt("time_limit_min"),
					),
				}
				g.races[format.Id] = r
			}
			person.text += " (" + w.StatusText(status, p.GetBool("confirmed")) + ")"
			r.people = append(r.people, person)
		}
	}

	byName := func(a, b who) int {
		return cmp.Or(cmp.Compare(a.sortKey, b.sortKey), cmp.Compare(a.id, b.id))
	}
	texts := func(people []who) []string {
		slices.SortFunc(people, byName)
		out := make([]string, len(people))
		for i, person := range people {
			out[i] = person.text
		}
		return out
	}

	var entries []Entry
	for _, g := range byEvent {
		event := g.event
		eventURL := appURL + "/evenements/" + event.Id
		monthOnly := events.MonthOnly(event)
		end := event.GetString("end_date")
		if monthOnly {
			end = ""
		}
		days, ok := dayEntry(event.GetString("start_date"), end)
		if !ok {
			continue
		}

		races := make([]*race, 0, len(g.races))
		for _, r := range g.races {
			races = append(races, r)
		}
		slices.SortFunc(races, func(a, b *race) int {
			return cmp.Or(cmp.Compare(a.first, b.first), cmp.Compare(a.name, b.name), cmp.Compare(a.id, b.id))
		})
		var lines []string
		for _, r := range races {
			lines = append(lines, w.Roster(r.name, texts(r.people)))
		}
		if len(g.undecided) > 0 {
			lines = append(lines, w.Roster(w.Undecided(), texts(g.undecided)))
		}
		if len(g.supporters) > 0 {
			lines = append(lines, w.Roster(w.Supporters(), texts(g.supporters)))
		}
		lines = append(lines, eventURL)

		entry := Entry{
			UID:         "group-" + event.Id + uidSuffix,
			Summary:     event.GetString("name"),
			Description: strings.Join(lines, "\n"),
			Location:    event.GetString("location"),
			URL:         eventURL,
			Start:       days.Start,
			End:         days.End,
		}
		if monthOnly {
			entry.Summary += " (" + w.DateToBeSet() + ")"
		}
		entries = append(entries, entry)
	}
	slices.SortFunc(entries, func(a, b Entry) int {
		return cmp.Or(cmp.Compare(a.Start, b.Start), cmp.Compare(a.UID, b.UID))
	})
	return entries, nil
}
