package mcp

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"

	"courses/server/wording"
)

// What the tools that write a race share (spec § 6.5): create_event,
// update_event and delete_event (tools_events.go), add_format, update_format and
// delete_format (tools_formats.go). A race is written as the form of the site
// writes it: a draft of the whole race, the end of the race from its formats,
// and one batch (plan.go).

// longEventWarning is the warning of the form for a race of more than two weeks
// (fr.form.periodLong).
const longEventWarning = "Plus de deux semaines : vérifie les dates des épreuves."

// eventWriteOut is the answer of a tool that writes a race: done, and, once it
// is done, the race as get_event gives it.
type eventWriteOut struct {
	writeStatus
	*eventDetail
}

// eventWriteSchema is the output of the tools that write a race. Made once, so
// that the servers that OnServe makes again share it (the schema cache keeps it
// by pointer).
var eventWriteSchema = sync.OnceValue(writeSchema[eventWriteOut])

// ---------------------------------------------------------------------------
// The inputs

// formatIn is a format of create_event, and the one of add_format (spec § 6.5).
type formatIn struct {
	RaceType       string  `json:"race_type" jsonschema:"l'identifiant ou le nom du type de course (list_race_types)"`
	Name           string  `json:"name,omitempty" jsonschema:"un nom propre ; sans nom, le site l'appelle par son type et sa mesure (Trail 42 km)"`
	DistanceKm     float64 `json:"distance_km,omitempty" jsonschema:"la distance en km, décimales permises (42.195)"`
	ElevationGainM int     `json:"elevation_gain_m,omitempty" jsonschema:"le dénivelé positif, en mètres"`
	DurationMin    int     `json:"duration_min,omitempty" jsonschema:"la durée d'une course au temps, en minutes (6 h = 360)"`
	TimeLimitMin   int     `json:"time_limit_min,omitempty" jsonschema:"la barrière horaire, en minutes (46 h 30 = 2790)"`
	PriceEur       float64 `json:"price_eur,omitempty" jsonschema:"le prix en euros, au centime"`
	RouteURL       string  `json:"route_url,omitempty" jsonschema:"un lien vers le parcours"`
	Date           string  `json:"date,omitempty" jsonschema:"AAAA-MM-JJ : le jour de l'épreuve quand ce n'est pas le premier jour de la course, jamais avant ; la fin de la course en découle"`
}

// formatPatchIn is a change of a format (update_event.formats, update_format): a
// field that is absent does not change; 0 or an empty text clears it.
type formatPatchIn struct {
	FormatID       string   `json:"format_id" jsonschema:"l'identifiant de l'épreuve, tel que get_event le donne"`
	RaceType       *string  `json:"race_type,omitempty" jsonschema:"l'identifiant ou le nom du type de course (list_race_types)"`
	Name           *string  `json:"name,omitempty" jsonschema:"un nom propre ; vide : le site l'appelle par son type et sa mesure"`
	DistanceKm     *float64 `json:"distance_km,omitempty" jsonschema:"la distance en km ; 0 l'efface"`
	ElevationGainM *int     `json:"elevation_gain_m,omitempty" jsonschema:"le dénivelé positif, en mètres ; 0 l'efface"`
	DurationMin    *int     `json:"duration_min,omitempty" jsonschema:"la durée d'une course au temps, en minutes ; 0 l'efface"`
	TimeLimitMin   *int     `json:"time_limit_min,omitempty" jsonschema:"la barrière horaire, en minutes ; 0 l'efface"`
	PriceEur       *float64 `json:"price_eur,omitempty" jsonschema:"le prix en euros, au centime ; 0 l'efface"`
	RouteURL       *string  `json:"route_url,omitempty" jsonschema:"un lien vers le parcours ; vide l'efface"`
	Date           *string  `json:"date,omitempty" jsonschema:"AAAA-MM-JJ : le jour de l'épreuve ; vide : le premier jour de la course. La fin de la course en découle"`
}

// The numbers of a format, which are never below 0 (the minimum of the form,
// and of the fields of the site).
var formatNumbers = []string{"distance_km", "elevation_gain_m", "duration_min", "time_limit_min", "price_eur"}

// ---------------------------------------------------------------------------
// Reading, normalizing, writing

// eventForWrite is the race that a write tool works on: the event with
// eventExpand and its author. An id that is not one is not looked up.
func (t *tools) eventForWrite(ctx context.Context, id string) (eventView, error) {
	if !isID(id) {
		return eventView{}, errNotFound
	}
	var record eventRecord
	query := url.Values{"expand": {eventExpand + ",created_by"}}
	if err := t.inner.get(ctx, "/api/collections/events/records/"+id+"?"+query.Encode(), &record); err != nil {
		return eventView{}, err
	}
	return newEventView(record)
}

// formatIDOf is the id of a format that a tool was given, without the blanks
// around it, or the refusal that says what is wrong with it.
func formatIDOf(input string) (string, error) {
	id := strings.TrimSpace(input)
	switch {
	case id == "":
		return "", errors.New("Il manque l'identifiant de l'épreuve (format_id) : get_event donne ceux des épreuves d'une course.")
	case !isID(id):
		return "", fmt.Errorf("« %s » n'est pas un identifiant d'épreuve : get_event donne ceux des épreuves d'une course.", id)
	}
	return id, nil
}

// eventOfFormat is the race of a format, read for a write.
func (t *tools) eventOfFormat(ctx context.Context, formatID string) (eventView, error) {
	var format formatRecord
	if err := t.inner.get(ctx, "/api/collections/formats/records/"+formatID, &format); err != nil {
		return eventView{}, err
	}
	return t.eventForWrite(ctx, format.Event)
}

// storedOf is the race as it is stored, for planBatch.
func storedOf(view eventView) *storedEvent {
	r := view.record
	stored := &storedEvent{
		ID: r.ID, StartDate: r.StartDate, EndDate: r.EndDate,
		Name: r.Name, Location: r.Location, RegistrationURL: r.RegistrationURL, RegistrationDeadline: r.RegistrationDeadline, Notes: r.Notes,
	}
	for _, f := range view.formats {
		stored.Formats = append(stored.Formats, draftOfRecord(f.record))
	}
	return stored
}

// draftOfRecord is a stored format as the form holds it.
func draftOfRecord(f formatRecord) formatDraft {
	return formatDraft{
		ID: f.ID, Name: f.Name, RaceType: f.RaceType, RouteURL: f.RouteURL, Date: f.Date,
		DistanceKm: f.DistanceKm, PriceEur: f.PriceEur,
		DurationMin: f.DurationMin, TimeLimitMin: f.TimeLimitMin, ElevationGainM: f.ElevationGainM,
	}
}

// draftOf is the race as the form of the site opens it to edit it (initialDraft
// of formDraft.ts): its formats in the order the page shows them.
func draftOf(view eventView) eventDraft {
	r := view.record
	draft := eventDraft{
		ID: r.ID, Name: r.Name, Location: r.Location, StartDate: r.StartDate, EndDate: r.EndDate,
		RegistrationURL: r.RegistrationURL, RegistrationDeadline: r.RegistrationDeadline, Notes: r.Notes,
	}
	for _, f := range view.formats {
		draft.Formats = append(draft.Formats, draftOfRecord(f.record))
	}
	return draft
}

// labelsOf are the names of the race types, by id: those of the formats of a
// race, and of the types given.
func labelsOf(view eventView, raceTypes []raceTypeRecord) map[string]string {
	labels := map[string]string{}
	for _, f := range view.formats {
		labels[f.raceType.ID] = f.raceType.Label
	}
	for _, r := range raceTypes {
		labels[r.ID] = r.Label
	}
	return labels
}

// titleOf is what the site calls a format of the form.
func titleOf(w wording.Words, f formatDraft, labels map[string]string) string {
	return w.RaceName(f.Name, labels[f.RaceType], f.DistanceKm, f.DurationMin, f.TimeLimitMin)
}

// formatSubject names a format of the form, by its place, in a message.
func formatSubject(index int, title string) string {
	return fmt.Sprintf("Épreuve %d (%s)", index+1, quote(title))
}

// measureRefusal is the refusal of the form for the first format of the draft
// that has no measure (hasMeasure), in the words of the site's refusal
// (format_measure_required on distance_km): the form does not send it.
func measureRefusal(w wording.Words, draft eventDraft, labels map[string]string) error {
	for i, f := range draft.Formats {
		if !hasMeasure(f) {
			return errors.New(formatSubject(i, titleOf(w, f, labels)) + ", " + fieldText("distance_km", "format_measure_required"))
		}
	}
	return nil
}

// The hints of a format dated before the start of its race: the race moves with
// its dated formats through formats of update_event; a new race has its formats
// from its first day.
const (
	moveHint  = " Pour déplacer la course avec ses épreuves datées, donne à chacune son nouveau jour dans formats (update_event)."
	startHint = " Une épreuve a lieu au plus tôt le premier jour de la course (start_date)."
)

// dateRefusal is the refusal of the form for the first format of the draft
// dated before its start, in the words of the site's refusal
// (format_date_out_of_range on date), followed by hint. The form does not send
// it: the day of a format has the start as its minimum (FormatFieldset.tsx). It
// is the only way a format falls out of the days of its race, whose end comes
// from its formats. Without a start, there is nothing to say: the site refuses
// the race.
func dateRefusal(w wording.Words, draft eventDraft, labels map[string]string, hint string) error {
	for i, f := range draft.Formats {
		if draft.StartDate != "" && f.Date != "" && f.Date < draft.StartDate {
			return errors.New(formatSubject(i, titleOf(w, f, labels)) + ", " + fieldText("date", "format_date_out_of_range") + hint)
		}
	}
	return nil
}

// normalizeFormat is a format of create_event or add_format as the form saves
// it: its race type by id, its texts trimmed, its day checked.
func normalizeFormat(in formatIn, raceTypes []raceTypeRecord) (formatDraft, error) {
	raceType, err := resolveRaceType(raceTypes, in.RaceType)
	if err != nil {
		return formatDraft{}, err
	}
	date, err := checkDay("date", in.Date)
	if err != nil {
		return formatDraft{}, err
	}
	return formatDraft{
		Name: strings.TrimSpace(in.Name), RaceType: raceType.ID, RouteURL: strings.TrimSpace(in.RouteURL), Date: date,
		DistanceKm: in.DistanceKm, PriceEur: in.PriceEur,
		DurationMin: in.DurationMin, TimeLimitMin: in.TimeLimitMin, ElevationGainM: in.ElevationGainM,
	}, nil
}

// needsRaceTypes reports whether changes of formats name a race type, which the
// tool then reads the types for.
func needsRaceTypes(patches []formatPatchIn) bool {
	return slices.ContainsFunc(patches, func(p formatPatchIn) bool { return p.RaceType != nil })
}

// normalizePatch is a change of a format with its race type by id (raceTypes
// were read when it names one), its texts trimmed and its day checked.
func normalizePatch(in formatPatchIn, raceTypes []raceTypeRecord) (formatPatchIn, error) {
	out := in
	out.FormatID = strings.TrimSpace(in.FormatID)
	out.Name, out.RouteURL = trimmed(in.Name), trimmed(in.RouteURL)
	if in.RaceType != nil {
		raceType, err := resolveRaceType(raceTypes, *in.RaceType)
		if err != nil {
			return formatPatchIn{}, err
		}
		out.RaceType = ptr(raceType.ID)
	}
	if in.Date != nil {
		date, err := checkDay("date", *in.Date)
		if err != nil {
			return formatPatchIn{}, err
		}
		out.Date = ptr(date)
	}
	return out, nil
}

// apply changes f by the fields that p gives.
func (p formatPatchIn) apply(f *formatDraft) {
	set := func(to *string, from *string) {
		if from != nil {
			*to = *from
		}
	}
	set(&f.RaceType, p.RaceType)
	set(&f.Name, p.Name)
	set(&f.RouteURL, p.RouteURL)
	set(&f.Date, p.Date)
	if p.DistanceKm != nil {
		f.DistanceKm = *p.DistanceKm
	}
	if p.PriceEur != nil {
		f.PriceEur = *p.PriceEur
	}
	if p.ElevationGainM != nil {
		f.ElevationGainM = *p.ElevationGainM
	}
	if p.DurationMin != nil {
		f.DurationMin = *p.DurationMin
	}
	if p.TimeLimitMin != nil {
		f.TimeLimitMin = *p.TimeLimitMin
	}
}

// normalizePatches are the changes of formats of a race, normalized, by format
// id: each names a format of the race, once. raceTypes were read when one names
// a type.
func normalizePatches(view eventView, patches []formatPatchIn, raceTypes []raceTypeRecord) ([]formatPatchIn, error) {
	w := wording.Of("fr")
	var out []formatPatchIn
	for _, p := range patches {
		id, err := formatIDOf(p.FormatID)
		if err != nil {
			return nil, err
		}
		i := slices.IndexFunc(view.formats, func(f formatView) bool { return f.record.ID == id })
		if i < 0 {
			return nil, fmt.Errorf("L'épreuve %s n'est pas une épreuve de %s : get_event donne les siennes.", id, quote(view.record.Name))
		}
		if slices.ContainsFunc(out, func(q formatPatchIn) bool { return q.FormatID == id }) {
			return nil, fmt.Errorf("L'épreuve %s est donnée deux fois dans formats : donne une seule modification par épreuve.", id)
		}
		p.FormatID = id
		normal, err := normalizePatch(p, raceTypes)
		if err != nil {
			return nil, fmt.Errorf("Épreuve %s, %s", quote(view.formats[i].title(w)), lowerFirst(err.Error()))
		}
		out = append(out, normal)
	}
	slices.SortFunc(out, func(a, b formatPatchIn) int { return cmp.Compare(a.FormatID, b.FormatID) })
	return out, nil
}

// applyPatches changes the formats of a draft by their patches.
func applyPatches(draft *eventDraft, patches []formatPatchIn) {
	for _, p := range patches {
		for i := range draft.Formats {
			if draft.Formats[i].ID == p.FormatID {
				p.apply(&draft.Formats[i])
			}
		}
	}
}

// sendBatch writes the operations in one batch: one transaction, as the form
// does.
func (t *tools) sendBatch(ctx context.Context, ops []batchOp) error {
	requests := make([]map[string]any, len(ops))
	for i, op := range ops {
		request := map[string]any{"method": op.Method, "url": op.URL}
		if op.Body != nil {
			request["body"] = op.Body
		}
		requests[i] = request
	}
	return t.inner.send(ctx, http.MethodPost, batchPath, map[string]any{"requests": requests}, nil)
}

// batchSubject names the request of a batch that the site refused (toSaveError
// of saveEvent.ts): the race, a format of the form by its place, the removal of a
// format, or the participation of join.
func batchSubject(w wording.Words, ops []batchOp, draft eventDraft, labels map[string]string, removed map[string]string) func(int) string {
	return func(i int) string {
		if i < 0 || i >= len(ops) {
			return "Une des écritures"
		}
		op := ops[i]
		switch op.Target {
		case targetEvent:
			return "La course"
		case targetFormat:
			return formatSubject(op.Format, titleOf(w, draft.Formats[op.Format], labels))
		case targetRemoval:
			return "La suppression de l'épreuve " + quote(removed[op.URL[strings.LastIndexByte(op.URL, '/')+1:]])
		}
		return "La participation (join)"
	}
}

// changeEvent is the end of a tool that changes a race that it read (update_event,
// update_format, add_format, delete_format): the form's draft, what the form
// refuses before sending, its risk unless the tool gives one, the confirmation,
// the batch, and the race read again. change makes the draft out of the race as
// it is; summary says what was done. A draft that changes nothing writes
// nothing, and says so.
func (t *tools) changeEvent(ctx context.Context, tool string, view eventView, labels map[string]string, args any, given string,
	change func(*eventDraft), r *risk, summary func(eventDraft) string,
) (eventWriteOut, error) {
	w := wording.Of("fr")
	stored := storedOf(view)
	draft := draftOf(view)
	change(&draft)
	draft.EndDate = eventEndDate(draft.StartDate, datesOf(draft))

	if err := measureRefusal(w, draft, labels); err != nil {
		return eventWriteOut{}, err
	}
	if err := dateRefusal(w, draft, labels, moveHint); err != nil {
		return eventWriteOut{}, err
	}
	if r == nil {
		r = changeRisk(w, view, draft)
	}
	proceed, out, notice, err := t.guard(ctx, tool, args, r, given)
	if err != nil {
		return eventWriteOut{}, describe(t.app, err, nil)
	}
	if !proceed {
		return eventWriteOut{writeStatus: notDoneOut(out, notice)}, nil
	}

	ops, eventID, _ := planBatch(draft, stored, "")
	if len(ops) == 0 {
		return t.written(ctx, eventID, "Rien à changer : "+quote(draft.Name)+" est déjà ainsi.", draft)
	}
	removed := map[string]string{}
	for _, f := range view.formats {
		removed[f.record.ID] = f.title(w)
	}
	if err := t.sendBatch(ctx, ops); err != nil {
		return eventWriteOut{}, describe(t.app, err, batchSubject(w, ops, draft, labels, removed))
	}
	return t.written(ctx, eventID, summary(draft), draft)
}

// written is the answer of a tool that wrote a race: the race read again.
func (t *tools) written(ctx context.Context, eventID, summary string, draft eventDraft) (eventWriteOut, error) {
	view, err := t.eventView(ctx, eventID)
	if err != nil {
		return eventWriteOut{}, describe(t.app, err, nil)
	}
	detail := view.detail(t.cfg, wording.Of("fr"))
	out := eventWriteOut{writeStatus: writeStatus{Done: true, Summary: summary}, eventDetail: &detail}
	if isLongEvent(draft.StartDate, draft.EndDate) {
		out.Warnings = []string{longEventWarning}
	}
	return out, nil
}

// datesOf are the days of the formats of a draft.
func datesOf(draft eventDraft) []string {
	dates := make([]string, len(draft.Formats))
	for i, f := range draft.Formats {
		dates[i] = f.Date
	}
	return dates
}

// ---------------------------------------------------------------------------
// The risks, and what the site refuses

// authorRefusal is the refusal that the site gives to deleting a race, or one of
// its formats, to a caller who is neither the author of the race nor an admin
// (the rules of events.delete and formats.delete); nil when the caller may. what
// is what is refused. The author is « la personne qui a créé la course »: a
// name says nothing of how a person is spoken of.
func authorRefusal(c *caller, view eventView, what string) error {
	author := view.record.Expand.CreatedBy
	if c.role == roleAdmin || (author.User != "" && author.User == c.user.Id) {
		return nil
	}
	if author.ID == "" {
		return errors.New("Seul un admin peut " + what + " : la course n'a plus d'auteur.")
	}
	return errors.New("Seule la personne qui a créé la course, " + plain(author.Name) + ", ou un admin peut " + what + ".")
}

// shortenedLine says that a race would be shortened, from its stored days to
// the ones it would have, and how the form says to keep them
// (fr.form.periodShortens).
func shortenedLine(start, end, newStart, newEnd string) string {
	return "La course serait raccourcie : avant, " + period(start, end) + " ; après, " + period(newStart, newEnd) + "." +
		" Pour garder ces jours, donne sa date à l'épreuve du dernier jour."
}

// clearedPhrases say that a field would be cleared, by field: the optional
// fields of a race, and the fields of a format.
var clearedPhrases = map[string]string{
	"registration_url":      "le lien d'inscription serait effacé",
	"registration_deadline": "la date limite d'inscription serait effacée",
	"name":                  "le nom serait effacé",
	"distance_km":           "la distance serait effacée",
	"elevation_gain_m":      "le D+ serait effacé",
	"duration_min":          "la durée serait effacée",
	"time_limit_min":        "le temps max serait effacé",
	"price_eur":             "le prix serait effacé",
	"route_url":             "le lien du parcours serait effacé",
	"date":                  "la date de l'épreuve serait effacée",
}

// days are the days of a race, as the messages write them: "2026-06-13", or
// "2026-06-13 au 2026-06-14".
func days(start, end string) string {
	if end == "" {
		return start
	}
	return start + " au " + end
}

// period is the days of a race in a sentence: "le 2026-06-13", or "du 2026-06-13
// au 2026-06-14".
func period(start, end string) string {
	if end == "" {
		return "le " + start
	}
	return "du " + start + " au " + end
}

// changeRisk is what saving draft over the race would clear or change of what
// people entered (spec § 6.13, update_event and update_format): a filled field
// cleared, notes replaced, the race shortened (shortens), the day of a format
// that has participants changed (its own date, or the start for a format that
// has none). nil when nothing.
func changeRisk(w wording.Words, view eventView, draft eventDraft) *risk {
	var r risk
	event := view.record
	eventShown := false
	for _, field := range []struct{ name, was, now string }{
		{"registration_url", event.RegistrationURL, draft.RegistrationURL},
		{"registration_deadline", event.RegistrationDeadline, draft.RegistrationDeadline},
	} {
		if strings.TrimSpace(field.was) != "" && field.now == "" {
			r.Details = append(r.Details, upperFirst(clearedPhrases[field.name])+" (actuellement : "+plain(field.was)+").")
			eventShown = true
		}
	}
	if strings.TrimSpace(event.Notes) != "" && draft.Notes != event.Notes {
		verb := "remplacées"
		if draft.Notes == "" {
			verb = "effacées"
		}
		r.Details = append(r.Details, "Les notes seraient "+verb+" (actuellement : "+quote(event.Notes)+").")
		eventShown = true
	}
	if shortens(event.StartDate, event.EndDate, draft.EndDate) {
		r.Details = append(r.Details, shortenedLine(event.StartDate, event.EndDate, draft.StartDate, draft.EndDate))
		eventShown = true
	}
	if eventShown {
		r.Records = append(r.Records, stamp{Collection: "events", ID: event.ID, Updated: event.Updated})
	}

	for i, f := range view.formats {
		now := draft.Formats[i]
		was := draftOfRecord(f.record)
		title := f.title(w)
		var lines []string

		dayWas, dayNow := cmp.Or(was.Date, event.StartDate), cmp.Or(now.Date, draft.StartDate)
		dayMoves := dayWas != dayNow && len(f.participations) > 0
		if dayMoves {
			lines = append(lines, "Le jour de l'épreuve "+quote(title)+" passerait du "+dayWas+" au "+dayNow+
				", pour ses participants : "+participantLabels(w, f.participations)+".")
		}
		for _, field := range []struct {
			name     string
			was, now bool
			value    string
		}{
			{"name", was.Name != "", now.Name != "", quote(was.Name)},
			{"distance_km", was.DistanceKm != 0, now.DistanceKm != 0, number(was.DistanceKm) + " km"},
			{"elevation_gain_m", was.ElevationGainM != 0, now.ElevationGainM != 0, strconv.Itoa(was.ElevationGainM) + " m"},
			{"duration_min", was.DurationMin != 0, now.DurationMin != 0, strconv.Itoa(was.DurationMin) + " min"},
			{"time_limit_min", was.TimeLimitMin != 0, now.TimeLimitMin != 0, strconv.Itoa(was.TimeLimitMin) + " min"},
			{"price_eur", was.PriceEur != 0, now.PriceEur != 0, number(was.PriceEur) + " €"},
			{"route_url", was.RouteURL != "", now.RouteURL != "", plain(was.RouteURL)},
			// The day that moves says it already.
			{"date", was.Date != "" && !dayMoves, now.Date != "", was.Date},
		} {
			if field.was && !field.now {
				lines = append(lines, "Épreuve "+quote(title)+" : "+clearedPhrases[field.name]+" (actuellement : "+field.value+").")
			}
		}
		if len(lines) > 0 {
			r.Details = append(r.Details, lines...)
			r.Records = append(r.Records, stamp{Collection: "formats", ID: f.record.ID, Updated: f.record.Updated})
		}
		if dayMoves {
			r.Records = append(r.Records, stampsOf(f.participations)...)
		}
	}

	if len(r.Details) == 0 {
		return nil
	}
	r.Message = "Cette modification de " + quote(event.Name) + " efface ou change ce que des personnes ont saisi : " + strings.Join(r.Details, " ")
	return &r
}
