package invitations

import (
	"cmp"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/events"
	"courses/server/wording"
)

// now is the clock of the package; the tests set it.
var now = time.Now

// How many lines and names a preview shows.
const (
	previewRaces  = 3
	previewPeople = 3
)

const (
	statusDNS       = "dns"
	statusSupporter = "supporter"
)

// UpcomingLine is a race of the invitee. It holds names and days only: this is
// what a public route answers (spec § 4.3).
type UpcomingLine struct {
	Event     string `json:"event"`
	Location  string `json:"location"`
	Day       string `json:"day"`
	MonthOnly bool   `json:"monthOnly"`
	// Formats is never nil: it is [] for a participation on the event alone.
	Formats []string `json:"formats"`
	// People is never nil.
	People     []string `json:"people"`
	MorePeople int      `json:"morePeople"`
}

// GroupLine is a race the group goes to and the invitee does not.
type GroupLine struct {
	Event      string   `json:"event"`
	Location   string   `json:"location"`
	Day        string   `json:"day"`
	MonthOnly  bool     `json:"monthOnly"`
	People     []string `json:"people"`
	MorePeople int      `json:"morePeople"`
}

// Upcoming is the races of the invitee: the first ones, and how many there are.
type Upcoming struct {
	Total int            `json:"total"`
	Races []UpcomingLine `json:"races"`
}

// Preview is what the page of an invitation shows before the account exists.
type Preview struct {
	InvitedBy *string     `json:"invitedBy"`
	Upcoming  Upcoming    `json:"upcoming"`
	Group     []GroupLine `json:"group"`
}

// ParisDay is the Paris day of t, YYYY-MM-DD.
func ParisDay(t time.Time) string {
	return t.In(parisZone()).Format(time.DateOnly)
}

// parisZone falls back to UTC when the zone database is missing, which is better
// than a route that cannot answer.
func parisZone() *time.Location {
	loc, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		return time.UTC
	}
	return loc
}

// ComputePreview is the preview of runnerID on the Paris day today; createdBy is
// invitations.created_by (empty: no author). w names the generated formats.
func ComputePreview(app core.App, runnerID, createdBy, today string, w wording.Words) (Preview, error) {
	preview := Preview{
		Upcoming: Upcoming{Races: []UpcomingLine{}},
		Group:    []GroupLine{},
	}

	author, err := events.RunnerOf(app, createdBy)
	if err != nil {
		return preview, err
	}
	if author != nil {
		name := author.GetString("name")
		preview.InvitedBy = &name
	}

	mine, err := app.FindAllRecords("participations", dbx.HashExp{"runner": runnerID})
	if err != nil {
		return preview, err
	}
	lines, err := upcomingLines(app, mine, today, w)
	if err != nil {
		return preview, err
	}
	shown := lines[:min(len(lines), previewRaces)]
	groupEvents, err := groupCandidates(app, mine, today)
	if err != nil {
		return preview, err
	}

	// Only the people of the lines that are shown are read.
	eventIDs := make([]any, 0, len(shown)+len(groupEvents))
	for _, line := range shown {
		eventIDs = append(eventIDs, line.event.Id)
	}
	for _, event := range groupEvents {
		eventIDs = append(eventIDs, event.Id)
	}
	people, err := crowdOf(app, eventIDs, runnerID)
	if err != nil {
		return preview, err
	}

	preview.Upcoming.Total = len(lines)
	for _, line := range shown {
		names, more := people.names(line.event.Id)
		preview.Upcoming.Races = append(preview.Upcoming.Races, UpcomingLine{
			Event:      line.event.GetString("name"),
			Location:   line.event.GetString("location"),
			Day:        line.day,
			MonthOnly:  events.MonthOnly(line.event),
			Formats:    line.formats,
			People:     names,
			MorePeople: more,
		})
	}
	for _, event := range groupEvents {
		names, more := people.names(event.Id)
		preview.Group = append(preview.Group, GroupLine{
			Event:      event.GetString("name"),
			Location:   event.GetString("location"),
			Day:        event.GetString("start_date"),
			MonthOnly:  events.MonthOnly(event),
			People:     names,
			MorePeople: more,
		})
	}
	return preview, nil
}

// upcomingLine is a race of the invitee before it is cut to its fields.
type upcomingLine struct {
	event   *core.Record
	order   string // LastRaceDay of the nearest kept participation
	day     string
	formats []string
}

// keptParticipation is a participation of the invitee that is not behind.
type keptParticipation struct {
	order, day, format string
	onFormat           bool
}

// upcomingLines are the races of the invitee that are not behind (the rule of
// "Mes prochaines courses"), one per event, in order.
func upcomingLines(app core.App, mine []*core.Record, today string, w wording.Words) ([]upcomingLine, error) {
	var eventIDs, formatIDs []string
	for _, p := range mine {
		if p.GetString("status") == statusDNS {
			continue
		}
		eventIDs = append(eventIDs, p.GetString("event"))
		if id := p.GetString("format"); id != "" {
			formatIDs = append(formatIDs, id)
		}
	}
	if len(eventIDs) == 0 {
		return nil, nil
	}
	eventRecords, err := app.FindRecordsByIds("events", eventIDs)
	if err != nil {
		return nil, err
	}
	formatRecords, err := app.FindRecordsByIds("formats", formatIDs)
	if err != nil {
		return nil, err
	}
	raceTypes, err := app.FindAllRecords("race_types")
	if err != nil {
		return nil, err
	}
	typeLabel := map[string]string{}
	for _, t := range raceTypes {
		typeLabel[t.Id] = t.GetString("label")
	}
	eventByID, formatByID := indexByID(eventRecords), indexByID(formatRecords)

	keptByEvent := map[string][]keptParticipation{}
	for _, p := range mine {
		if p.GetString("status") == statusDNS {
			continue
		}
		event := eventByID[p.GetString("event")]
		if event == nil {
			continue
		}
		start, monthOnly := event.GetString("start_date"), events.MonthOnly(event)
		var formatDay, name string
		format := formatByID[p.GetString("format")]
		if format != nil {
			formatDay = format.GetString("date")
			name = w.RaceName(
				format.GetString("name"), typeLabel[format.GetString("race_type")],
				format.GetFloat("distance_km"), format.GetInt("duration_min"), format.GetInt("time_limit_min"),
			)
		}
		until := events.UpcomingUntil(start, event.GetString("end_date"), formatDay, format != nil, monthOnly)
		if until < today {
			continue
		}
		// A race known by its month only is shown on the 1st of it.
		day := cmp.Or(formatDay, start)
		if monthOnly {
			day = start
		}
		keptByEvent[event.Id] = append(keptByEvent[event.Id], keptParticipation{
			order: events.LastRaceDay(start, formatDay, monthOnly), day: day,
			format: name, onFormat: format != nil,
		})
	}

	var lines []upcomingLine
	for id, list := range keptByEvent {
		slices.SortStableFunc(list, func(a, b keptParticipation) int {
			return cmp.Or(cmp.Compare(a.order, b.order), cmp.Compare(a.format, b.format))
		})
		line := upcomingLine{event: eventByID[id], order: list[0].order, day: list[0].day, formats: []string{}}
		for _, k := range list {
			if k.onFormat {
				line.formats = append(line.formats, k.format)
			}
		}
		lines = append(lines, line)
	}
	slices.SortFunc(lines, func(a, b upcomingLine) int {
		return cmp.Or(
			cmp.Compare(a.order, b.order),
			cmp.Compare(monthRank(a.event), monthRank(b.event)),
			cmp.Compare(wording.Fold(a.event.GetString("name")), wording.Fold(b.event.GetString("name"))),
			cmp.Compare(a.event.Id, b.event.Id),
		)
	})
	return lines, nil
}

func monthRank(event *core.Record) int {
	if events.MonthOnly(event) {
		return 1
	}
	return 0
}

// groupCandidates are the first events the group goes to and the invitee has no
// participation in at all (a "dns" is one): kept until their last day, with at
// least one runner who starts.
func groupCandidates(app core.App, mine []*core.Record, today string) ([]*core.Record, error) {
	mineOn := map[string]bool{}
	for _, p := range mine {
		mineOn[p.GetString("event")] = true
	}
	// The SQL only spares the rows of the past: the rule is applied again below
	// with the helpers that the MCP shares, which know the month-only events.
	candidates, err := app.FindAllRecords("events", dbx.NewExp(
		"COALESCE(NULLIF([[end_date]], ''), [[start_date]]) >= {:today} OR [[date_precision]] = 'month'",
		dbx.Params{"today": today},
	))
	if err != nil {
		return nil, err
	}
	var open []*core.Record
	var ids []any
	for _, event := range candidates {
		if mineOn[event.Id] {
			continue
		}
		last := events.UpcomingUntil(event.GetString("start_date"), event.GetString("end_date"), "", false, events.MonthOnly(event))
		if last < today {
			continue
		}
		open = append(open, event)
		ids = append(ids, event.Id)
	}
	if len(open) == 0 {
		return nil, nil
	}
	others, err := app.FindAllRecords("participations", dbx.In("event", ids...))
	if err != nil {
		return nil, err
	}
	hasStarter := map[string]bool{}
	for _, p := range others {
		if status := p.GetString("status"); status != statusDNS && status != statusSupporter {
			hasStarter[p.GetString("event")] = true
		}
	}
	var kept []*core.Record
	for _, event := range open {
		if hasStarter[event.Id] {
			kept = append(kept, event)
		}
	}
	// The order of the home page (sortEvents): the day that counts, the month-only
	// ones after the others of that day, then the name.
	orderDay := func(event *core.Record) string {
		return events.LastRaceDay(event.GetString("start_date"), "", events.MonthOnly(event))
	}
	slices.SortFunc(kept, func(a, b *core.Record) int {
		return cmp.Or(
			cmp.Compare(orderDay(a), orderDay(b)),
			cmp.Compare(monthRank(a), monthRank(b)),
			cmp.Compare(wording.Fold(a.GetString("name")), wording.Fold(b.GetString("name"))),
			cmp.Compare(a.Id, b.Id),
		)
	})
	return kept[:min(len(kept), previewRaces)], nil
}

// crowd is who goes to each event, by name, the invitee left out.
type crowd map[string][]string

// crowdOf reads the runners that have a participation that is not "dns" in the
// events, each once per event.
func crowdOf(app core.App, eventIDs []any, except string) (crowd, error) {
	result := crowd{}
	if len(eventIDs) == 0 {
		return result, nil
	}
	parts, err := app.FindAllRecords("participations", dbx.In("event", eventIDs...), dbx.NewExp("[[status]] != 'dns'"))
	if err != nil {
		return nil, err
	}
	var runnerIDs []string
	seen := map[[2]string]bool{}
	byEvent := map[string][]string{}
	for _, p := range parts {
		event, runner := p.GetString("event"), p.GetString("runner")
		if runner == except || seen[[2]string{event, runner}] {
			continue
		}
		seen[[2]string{event, runner}] = true
		byEvent[event] = append(byEvent[event], runner)
		runnerIDs = append(runnerIDs, runner)
	}
	if len(runnerIDs) == 0 {
		return result, nil
	}
	runners, err := app.FindRecordsByIds("runners", runnerIDs)
	if err != nil {
		return nil, err
	}
	nameOf := map[string]string{}
	for _, r := range runners {
		nameOf[r.Id] = r.GetString("name")
	}
	for event, ids := range byEvent {
		names := make([]string, 0, len(ids))
		for _, id := range ids {
			if name, ok := nameOf[id]; ok {
				names = append(names, name)
			}
		}
		slices.SortFunc(names, func(a, b string) int {
			return cmp.Or(cmp.Compare(wording.Fold(a), wording.Fold(b)), cmp.Compare(a, b))
		})
		result[event] = names
	}
	return result, nil
}

// names are the first people of an event and how many are left out.
func (c crowd) names(event string) ([]string, int) {
	all := c[event]
	first := make([]string, min(len(all), previewPeople))
	copy(first, all)
	return first, len(all) - len(first)
}

func indexByID(records []*core.Record) map[string]*core.Record {
	byID := make(map[string]*core.Record, len(records))
	for _, r := range records {
		byID[r.Id] = r
	}
	return byID
}
