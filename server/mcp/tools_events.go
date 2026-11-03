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
	"unicode"
	"unicode/utf8"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has the tools that write a race (spec § 6.5): create_event,
// update_event and delete_event, and what the tools of the formats
// (tools_formats.go) share with them. Each is written as « The pattern of a
// write tool » says: it reads, normalizes its input, announces the refusals that
// the site would give, computes its risk, goes through guard, writes in one
// request, and reads again.

// maxFormats is the most formats that a race is created with: the batch of the
// site takes 50 requests, and a race of 20 formats is far from that.
const maxFormats = 20

// The participation statuses of « Je participe » (STATUSES of the site): the
// ones of a participation on a format.
var formatStatuses = []string{"interested", "registered", "finished", "dnf", "dns"}

// longEventWarning is the warning of the form for a race of more than two weeks
// (fr.form.periodLong).
const longEventWarning = "Plus de deux semaines : vérifie les dates des épreuves."

// ---------------------------------------------------------------------------
// The answers

// writeStatus is what every write tool answers (spec § 6.1): done or not, a
// sentence, the warnings, and, when nothing was done, the confirmation to ask
// for.
type writeStatus struct {
	Done         bool             `json:"done" jsonschema:"vrai quand c'est fait ; faux quand rien n'a été fait : summary dit pourquoi, et confirmation ce qu'il faut demander à la personne"`
	Summary      string           `json:"summary" jsonschema:"ce qui a été fait, ou pourquoi rien ne l'a été, en une phrase"`
	Warnings     []string         `json:"warnings,omitempty" jsonschema:"ce qu'il vaut la peine de vérifier, sans que cela ait empêché quoi que ce soit"`
	Confirmation *confirmationOut `json:"confirmation,omitempty" jsonschema:"quand rien n'a été fait faute d'accord : ce qui serait perdu ou changé, et le jeton à redonner si la personne accepte"`
}

// eventWriteOut is the answer of a tool that writes a race: done, and, once it
// is done, the race as get_event gives it.
type eventWriteOut struct {
	writeStatus
	*eventDetail
}

// writeSchema is the output schema of a write tool: the one of T, where only
// done and summary are always there (a call that did nothing has no race).
func writeSchema[T any]() *jsonschema.Schema {
	var zero T
	schema, err := jsonschema.For[T](nil)
	if err != nil {
		panic(fmt.Sprintf("mcp: the schema of %T: %v", zero, err))
	}
	schema.Required = []string{"done", "summary"}
	return schema
}

// eventWriteSchema is the output of the tools that write a race. Made once, so
// that the servers that OnServe makes again share it (the schema cache keeps it
// by pointer).
var eventWriteSchema = sync.OnceValue(writeSchema[eventWriteOut])

// notDoneOut is the answer of a call that wrote nothing.
func notDoneOut(out *confirmationOut, notice string) writeStatus {
	return writeStatus{Summary: notDone(out, notice), Confirmation: out}
}

// writeAnnotations are the annotations of a tool that writes (spec § 6.1).
func writeAnnotations(destructive, idempotent bool) *mcpsdk.ToolAnnotations {
	return &mcpsdk.ToolAnnotations{DestructiveHint: ptr(destructive), IdempotentHint: idempotent, OpenWorldHint: ptr(false)}
}

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

// withMinimum sets the minimum of the numbers at these paths of schema, as
// inputSchema finds a field (a field of the items of a list by its path).
func withMinimum(schema *jsonschema.Schema, minimum float64, paths ...string) *jsonschema.Schema {
	for _, path := range paths {
		property := schema
		for name := range strings.SplitSeq(path, ".") {
			if property.Items != nil {
				property = property.Items
			}
			property = property.Properties[name]
			if property == nil {
				panic("mcp: no field " + path + " in a schema")
			}
		}
		property.Minimum = ptr(minimum)
	}
	return schema
}

// prefixed is each of names after prefix and a dot.
func prefixed(prefix string, names []string) []string {
	out := make([]string, len(names))
	for i, name := range names {
		out[i] = prefix + "." + name
	}
	return out
}

// ---------------------------------------------------------------------------
// What the tools share

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
	stored := &storedEvent{ID: view.record.ID, StartDate: view.record.StartDate, EndDate: view.record.EndDate}
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
	return fmt.Sprintf("Épreuve %d (« %s »)", index+1, title)
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

// trimmed is s without the blanks around it; nil stays nil.
func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	return ptr(strings.TrimSpace(*s))
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
			return "La suppression de l'épreuve « " + removed[op.URL[strings.LastIndexByte(op.URL, '/')+1:]] + " »"
		}
		return "La participation (join)"
	}
}

// changeEvent is the end of a tool that changes a race that it read (update_event,
// update_format, add_format, delete_format): the form's draft, its risk unless
// the tool gives one, the confirmation, the batch, and the race read again.
// change makes the draft out of the race as it is; summary says what was done.
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
// The words of the risks

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

// number writes a number as the site does in French: a comma before the
// decimals.
func number(v float64) string {
	return strings.ReplaceAll(strconv.FormatFloat(v, 'f', -1, 64), ".", ",")
}

// upperFirst writes the first letter of s in upper case: a phrase that starts a
// sentence.
func upperFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}

// plural is n and the noun that agrees with it (one for 0 and 1, as French
// says it).
func plural(n int, one, many string) string {
	if n > 1 {
		return strconv.Itoa(n) + " " + many
	}
	return strconv.Itoa(n) + " " + one
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

// participantLabel is a participation as a confirmation names it: the runner,
// the status (and the result when there is one), and whether it is confirmed:
// « Bob (Intéressé, non confirmé) ».
func participantLabel(w wording.Words, p participationRecord) string {
	text := resultText(w, p)
	if !p.Confirmed {
		text += ", non confirmé"
	}
	return p.Expand.Runner.Name + " (" + text + ")"
}

// participantLabels are participations as a confirmation names them.
func participantLabels(w wording.Words, list []participationRecord) string {
	labels := make([]string, len(list))
	for i, p := range list {
		labels[i] = participantLabel(w, p)
	}
	return strings.Join(labels, ", ")
}

// stampsOf are the stamps of participations.
func stampsOf(list []participationRecord) []stamp {
	out := make([]stamp, len(list))
	for i, p := range list {
		out[i] = stamp{Collection: "participations", ID: p.ID, Updated: p.Updated}
	}
	return out
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
			r.Details = append(r.Details, upperFirst(clearedPhrases[field.name])+" (actuellement : "+field.was+").")
			eventShown = true
		}
	}
	if strings.TrimSpace(event.Notes) != "" && draft.Notes != event.Notes {
		verb := "remplacées"
		if draft.Notes == "" {
			verb = "effacées"
		}
		r.Details = append(r.Details, "Les notes seraient "+verb+" (actuellement : « "+event.Notes+" »).")
		eventShown = true
	}
	if shortens(event.StartDate, event.EndDate, draft.EndDate) {
		r.Details = append(r.Details, "La course serait raccourcie : avant, "+period(event.StartDate, event.EndDate)+
			" ; après, "+period(draft.StartDate, draft.EndDate)+".")
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
			lines = append(lines, "Le jour de l'épreuve « "+title+" » passerait du "+dayWas+" au "+dayNow+
				", pour ses participants : "+participantLabels(w, f.participations)+".")
		}
		for _, field := range []struct {
			name     string
			was, now bool
			value    string
		}{
			{"name", was.Name != "", now.Name != "", "« " + was.Name + " »"},
			{"distance_km", was.DistanceKm != 0, now.DistanceKm != 0, number(was.DistanceKm) + " km"},
			{"elevation_gain_m", was.ElevationGainM != 0, now.ElevationGainM != 0, strconv.Itoa(was.ElevationGainM) + " m"},
			{"duration_min", was.DurationMin != 0, now.DurationMin != 0, strconv.Itoa(was.DurationMin) + " min"},
			{"time_limit_min", was.TimeLimitMin != 0, now.TimeLimitMin != 0, strconv.Itoa(was.TimeLimitMin) + " min"},
			{"price_eur", was.PriceEur != 0, now.PriceEur != 0, number(was.PriceEur) + " €"},
			{"route_url", was.RouteURL != "", now.RouteURL != "", was.RouteURL},
			// The day that moves says it already.
			{"date", was.Date != "" && !dayMoves, now.Date != "", was.Date},
		} {
			if field.was && !field.now {
				lines = append(lines, "Épreuve « "+title+" » : "+clearedPhrases[field.name]+" (actuellement : "+field.value+").")
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
	r.Message = "Cette modification de « " + event.Name + " » efface ou change ce que des personnes ont saisi : " + strings.Join(r.Details, " ")
	return &r
}

// ---------------------------------------------------------------------------
// create_event

// joinIn is « Je participe » of the form of a new race.
type joinIn struct {
	FormatIndex int    `json:"format_index" jsonschema:"l'indice de l'épreuve dans formats, à partir de 0"`
	Status      string `json:"status" jsonschema:"le statut de la participation : interested (Intéressé), registered (Inscrit sur le site officiel), dns (Non partant) ; finished (Terminé) et dnf (Abandon) seulement à partir du jour de l'épreuve"`
}

type createEventIn struct {
	Name                 string     `json:"name" jsonschema:"le nom de la course, 1 à 120 caractères"`
	Location             string     `json:"location" jsonschema:"une ville ou un lieu"`
	StartDate            string     `json:"start_date" jsonschema:"AAAA-MM-JJ : le premier jour"`
	RegistrationURL      string     `json:"registration_url,omitempty" jsonschema:"la page d'inscription officielle"`
	RegistrationDeadline string     `json:"registration_deadline,omitempty" jsonschema:"AAAA-MM-JJ : le dernier jour pour s'inscrire, au plus tard start_date"`
	Notes                string     `json:"notes,omitempty"`
	Formats              []formatIn `json:"formats" jsonschema:"les épreuves, de 1 à 20"`
	Join                 *joinIn    `json:"join,omitempty" jsonschema:"« Je participe » : ajoute la personne au nom de qui tu agis à une épreuve de la course, avec ce statut"`
	Confirmation         string     `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var createEventSchema = sync.OnceValue(func() *jsonschema.Schema {
	schema := inputSchema[createEventIn](map[string][]string{"join.status": formatStatuses})
	withMinimum(schema, 0, "join.format_index")
	return withMinimum(schema, 0, prefixed("formats", formatNumbers)...)
})

func addCreateEvent(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "create_event",
		Title: "Créer une course",
		Description: "Crée une course (un événement et ses épreuves) en une seule écriture, comme le formulaire « + » du site. " +
			"Cherche-la d'abord avec search_events : elle existe peut-être déjà. Quand une course semblable existe (un mot du nom en commun, à 30 jours près), " +
			"rien n'est créé au premier appel : la réponse les nomme et donne un jeton de confirmation. " +
			"Chaque épreuve a au moins une mesure, distance_km, duration_min ou time_limit_min : de préférence celles de son type (list_race_types). " +
			"La date de fin vient des épreuves : une épreuve datée après start_date allonge la course. " +
			"join ajoute la personne au nom de qui tu agis à une épreuve, comme « Je participe ». La trace GPX d'une épreuve passe par set_track. " +
			"Donne la course comme get_event.",
		InputSchema:  createEventSchema(),
		OutputSchema: eventWriteSchema(),
		Annotations:  writeAnnotations(true, false),
	}, t.createEvent)
}

func (t *tools) createEvent(ctx context.Context, _ *mcpsdk.CallToolRequest, in createEventIn) (*mcpsdk.CallToolResult, eventWriteOut, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, eventWriteOut, error) {
		return nil, eventWriteOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, eventWriteOut, error) {
		return nil, eventWriteOut{}, err
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	w := wording.Of("fr")

	// What the call needs: the race types, and the runner of the caller for
	// « Je participe ».
	raceTypes, err := t.raceTypes(ctx)
	if err != nil {
		return fail(err)
	}
	var me runnerRecord
	if in.Join != nil {
		runners, err := t.runners(ctx)
		if err != nil {
			return fail(err)
		}
		id := runnerOfAccount(runners, c.user.Id)
		i := slices.IndexFunc(runners, func(r runnerRecord) bool { return r.ID == id })
		if id == "" || i < 0 {
			return refuse(errors.New(noRunner))
		}
		me = runners[i]
	}

	// The input, as the form saves it.
	draft := eventDraft{
		Name: strings.TrimSpace(in.Name), Location: strings.TrimSpace(in.Location),
		RegistrationURL: strings.TrimSpace(in.RegistrationURL), Notes: strings.TrimSpace(in.Notes),
	}
	if draft.StartDate, err = checkDay("start_date", in.StartDate); err != nil {
		return refuse(err)
	}
	if draft.RegistrationDeadline, err = checkDay("registration_deadline", in.RegistrationDeadline); err != nil {
		return refuse(err)
	}
	switch {
	case len(in.Formats) == 0:
		return refuse(errors.New("Une course a au moins une épreuve : donne-la dans formats."))
	case len(in.Formats) > maxFormats:
		return refuse(fmt.Errorf("Une course se crée avec %d épreuves au plus (%d données) : ajoute les autres ensuite avec add_format.", maxFormats, len(in.Formats)))
	}
	for i, f := range in.Formats {
		format, err := normalizeFormat(f, raceTypes)
		if err != nil {
			return refuse(fmt.Errorf("Épreuve %d, %s", i+1, lowerFirst(err.Error())))
		}
		draft.Formats = append(draft.Formats, format)
	}
	if in.Join != nil {
		if in.Join.FormatIndex < 0 || in.Join.FormatIndex >= len(draft.Formats) {
			return refuse(fmt.Errorf("join.format_index : il n'y a pas d'épreuve %d ; les épreuves de formats vont de 0 à %d.", in.Join.FormatIndex, len(draft.Formats)-1))
		}
		draft.Join = &joinDraft{FormatIndex: in.Join.FormatIndex, Status: in.Join.Status}
	}
	draft.EndDate = eventEndDate(draft.StartDate, datesOf(draft))

	// What the form refuses before sending.
	labels := labelsOf(eventView{}, raceTypes)
	if err := measureRefusal(w, draft, labels); err != nil {
		return refuse(err)
	}

	// The races like it: a confirmation names them.
	duplicates, err := t.duplicateViews(ctx, draft.Name, draft.StartDate, "")
	if err != nil {
		return fail(err)
	}
	proceed, out, notice, err := t.guard(ctx, "create_event", draft, t.duplicateRisk(w, duplicates), strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, eventWriteOut{writeStatus: notDoneOut(out, notice)}, nil
	}

	ops, eventID, _ := planBatch(draft, nil, me.ID)
	if err := t.sendBatch(ctx, ops); err != nil {
		return nil, eventWriteOut{}, describe(t.app, err, batchSubject(w, ops, draft, labels, nil))
	}

	summary := fmt.Sprintf("La course « %s » est créée (%s, %s), avec %s.", draft.Name, days(draft.StartDate, draft.EndDate), draft.Location,
		plural(len(draft.Formats), "épreuve", "épreuves"))
	if draft.Join != nil {
		summary += fmt.Sprintf(" %s participe à « %s » (%s).", me.Name, titleOf(w, draft.Formats[draft.Join.FormatIndex], labels), w.Status(draft.Join.Status))
	}
	answer, err := t.written(ctx, eventID, summary, draft)
	return nil, answer, err
}

// duplicateRisk is the confirmation of a race that may exist already: the races
// like it, each with its days, its place, its participants and its id.
func (t *tools) duplicateRisk(w wording.Words, duplicates []eventView) *risk {
	if len(duplicates) == 0 {
		return nil
	}
	var r risk
	for _, v := range duplicates {
		s := v.summary(t.cfg, w, "")
		r.Details = append(r.Details, fmt.Sprintf("« %s » (%s, %s, %s, id %s)", s.Name, days(s.StartDate, s.EndDate), s.Location,
			plural(s.Participants, "participant", "participants"), s.ID))
		r.Records = append(r.Records, stamp{Collection: "events", ID: v.record.ID, Updated: v.record.Updated})
	}
	r.Message = "Des courses semblables existent déjà : " + strings.Join(r.Details, ", ") +
		". En créer une autre ferait peut-être un doublon : vérifie avec la personne que ce n'est aucune d'elles."
	return &r
}

// ---------------------------------------------------------------------------
// update_event

type updateEventIn struct {
	EventID              string          `json:"event_id" jsonschema:"l'identifiant de la course, tel que search_events le donne"`
	Name                 *string         `json:"name,omitempty" jsonschema:"le nom de la course, 1 à 120 caractères"`
	Location             *string         `json:"location,omitempty" jsonschema:"une ville ou un lieu"`
	StartDate            *string         `json:"start_date,omitempty" jsonschema:"AAAA-MM-JJ : le premier jour. Les épreuves sans date le suivent ; une épreuve datée se déplace avec formats"`
	RegistrationURL      *string         `json:"registration_url,omitempty" jsonschema:"la page d'inscription officielle ; vide l'efface"`
	RegistrationDeadline *string         `json:"registration_deadline,omitempty" jsonschema:"AAAA-MM-JJ : le dernier jour pour s'inscrire, au plus tard start_date ; vide l'efface"`
	Notes                *string         `json:"notes,omitempty" jsonschema:"vide les efface"`
	Formats              []formatPatchIn `json:"formats,omitempty" jsonschema:"des modifications d'épreuves, écrites avec la course"`
	Confirmation         string          `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var updateEventSchema = sync.OnceValue(func() *jsonschema.Schema {
	return withMinimum(inputSchema[updateEventIn](nil), 0, prefixed("formats", formatNumbers)...)
})

// updateEventArgs are the arguments of update_event, normalized: the texts
// trimmed, the race types by id, the changes of the formats by id.
type updateEventArgs struct {
	Event                                                                   string
	Name, Location, StartDate, RegistrationURL, RegistrationDeadline, Notes *string
	Formats                                                                 []formatPatchIn
}

func addUpdateEvent(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "update_event",
		Title: "Modifier une course",
		Description: "Modifie une course, comme le formulaire « Modifier » du site (tout membre le peut, pas seulement son auteur). " +
			"Un champ absent ne change pas ; un texte vide efface un champ facultatif. " +
			"formats modifie des épreuves dans la même écriture (format_id obligatoire, mêmes règles) : c'est ce qui déplace une course avec ses épreuves datées en un appel. " +
			"La date de fin vient des épreuves. Ce qui effacerait ou changerait ce que des personnes ont saisi " +
			"(un champ vidé, des notes remplacées, une course raccourcie, le jour d'une épreuve qui a des participants) " +
			"n'est fait qu'au second appel, avec le jeton de confirmation que le premier donne. Donne la course comme get_event.",
		InputSchema:  updateEventSchema(),
		OutputSchema: eventWriteSchema(),
		Annotations:  writeAnnotations(true, true),
	}, t.updateEvent)
}

func (t *tools) updateEvent(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateEventIn) (*mcpsdk.CallToolResult, eventWriteOut, error) {
	id, err := eventIDOf(in.EventID)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	view, err := t.eventForWrite(ctx, id)
	if err != nil {
		return nil, eventWriteOut{}, describe(t.app, err, nil)
	}

	var raceTypes []raceTypeRecord
	if needsRaceTypes(in.Formats) {
		if raceTypes, err = t.raceTypes(ctx); err != nil {
			return nil, eventWriteOut{}, describe(t.app, err, nil)
		}
	}

	// The input, normalized.
	args := updateEventArgs{Event: id}
	args.Name, args.Location, args.RegistrationURL, args.Notes = trimmed(in.Name), trimmed(in.Location), trimmed(in.RegistrationURL), trimmed(in.Notes)
	for _, day := range []struct {
		name   string
		in     *string
		normal **string
	}{
		{"start_date", in.StartDate, &args.StartDate},
		{"registration_deadline", in.RegistrationDeadline, &args.RegistrationDeadline},
	} {
		if day.in == nil {
			continue
		}
		checked, err := checkDay(day.name, *day.in)
		if err != nil {
			return nil, eventWriteOut{}, err
		}
		*day.normal = &checked
	}
	patches, err := normalizePatches(view, in.Formats, raceTypes)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	args.Formats = patches
	labels := labelsOf(view, raceTypes)

	change := func(draft *eventDraft) {
		set := func(to *string, from *string) {
			if from != nil {
				*to = *from
			}
		}
		set(&draft.Name, args.Name)
		set(&draft.Location, args.Location)
		set(&draft.StartDate, args.StartDate)
		set(&draft.RegistrationURL, args.RegistrationURL)
		set(&draft.RegistrationDeadline, args.RegistrationDeadline)
		set(&draft.Notes, args.Notes)
		applyPatches(draft, patches)
	}
	summary := func(draft eventDraft) string {
		return fmt.Sprintf("La course « %s » est modifiée (%s, %s).", draft.Name, days(draft.StartDate, draft.EndDate), draft.Location)
	}
	answer, err := t.changeEvent(ctx, "update_event", view, labels, args, strings.TrimSpace(in.Confirmation), change, nil, summary)
	return nil, answer, err
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
			return nil, fmt.Errorf("L'épreuve %s n'est pas une épreuve de « %s » : get_event donne les siennes.", id, view.record.Name)
		}
		if slices.ContainsFunc(out, func(q formatPatchIn) bool { return q.FormatID == id }) {
			return nil, fmt.Errorf("L'épreuve %s est donnée deux fois dans formats : donne une seule modification par épreuve.", id)
		}
		p.FormatID = id
		normal, err := normalizePatch(p, raceTypes)
		if err != nil {
			return nil, fmt.Errorf("Épreuve « %s », %s", view.formats[i].title(w), lowerFirst(err.Error()))
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

// ---------------------------------------------------------------------------
// delete_event

type deleteEventIn struct {
	EventID      string `json:"event_id" jsonschema:"l'identifiant de la course, tel que search_events le donne"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

type deleteEventOut struct {
	writeStatus
	Removed *removedEvent `json:"removed,omitempty" jsonschema:"la course supprimée"`
}

type removedEvent struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	StartDate string `json:"start_date"`
}

var deleteEventSchema = sync.OnceValue(writeSchema[deleteEventOut])

func addDeleteEvent(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "delete_event",
		Title: "Supprimer une course",
		Description: "Supprime une course, comme « Supprimer » de sa fiche : ses épreuves, ses participations, ses commentaires et ses offres de covoiturage et de logement partent avec elle. " +
			"Seuls la personne qui l'a créée et les admins le peuvent. Le premier appel ne fait rien : il dit ce qui serait perdu et donne un jeton de confirmation. " +
			"Une course en double se fusionne plutôt (un admin, Admin → Doublons), ce qui garde ce qu'elle contient.",
		InputSchema:  inputSchema[deleteEventIn](nil),
		OutputSchema: deleteEventSchema(),
		Annotations:  writeAnnotations(true, false),
	}, t.deleteEvent)
}

// authorRefusal is the refusal that the site gives to deleting a race, or one of
// its formats, to a caller who is neither the author of the race nor an admin
// (the rules of events.delete and formats.delete); "" when the caller may. what
// is what is refused.
func authorRefusal(c *caller, view eventView, what string) error {
	author := view.record.Expand.CreatedBy
	if c.role == roleAdmin || (author.User != "" && author.User == c.user.Id) {
		return nil
	}
	if author.ID == "" {
		return errors.New("Seul un admin peut " + what + " : la course n'a plus d'auteur.")
	}
	return errors.New("Seule " + author.Name + ", qui a créé la course, ou un admin peut " + what + ".")
}

// countOf is the number of records of a collection that are of the event id.
func (t *tools) countOf(ctx context.Context, collection, id string) (int, error) {
	query := url.Values{"filter": {"(event='" + id + "')"}, "perPage": {"1"}, "page": {"1"}}
	var answer struct {
		TotalItems int `json:"totalItems"`
	}
	if err := t.inner.get(ctx, "/api/collections/"+collection+"/records?"+query.Encode(), &answer); err != nil {
		return 0, err
	}
	return answer.TotalItems, nil
}

func (t *tools) deleteEvent(ctx context.Context, _ *mcpsdk.CallToolRequest, in deleteEventIn) (*mcpsdk.CallToolResult, deleteEventOut, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, deleteEventOut, error) {
		return nil, deleteEventOut{}, describe(t.app, err, nil)
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	id, err := eventIDOf(in.EventID)
	if err != nil {
		return nil, deleteEventOut{}, err
	}
	view, err := t.eventForWrite(ctx, id)
	if err != nil {
		return fail(err)
	}
	if err := authorRefusal(c, view, "la supprimer"); err != nil {
		return nil, deleteEventOut{}, err
	}
	comments, err := t.countOf(ctx, "comments", id)
	if err != nil {
		return fail(err)
	}
	offers, err := t.countOf(ctx, "offers", id)
	if err != nil {
		return fail(err)
	}

	w := wording.Of("fr")
	event := view.record
	r := risk{Records: []stamp{{Collection: "events", ID: event.ID, Updated: event.Updated}}}
	for _, f := range view.formats {
		line := "Épreuve « " + f.title(w) + " »"
		if len(f.participations) > 0 {
			line += " : " + participantLabels(w, f.participations)
		} else {
			line += ", sans participant"
		}
		r.Details = append(r.Details, line+".")
		r.Records = append(r.Records, stamp{Collection: "formats", ID: f.record.ID, Updated: f.record.Updated})
	}
	if len(view.undecided) > 0 {
		r.Details = append(r.Details, "Intéressés sans épreuve : "+participantLabels(w, view.undecided)+".")
	}
	if len(view.supporters) > 0 {
		r.Details = append(r.Details, "Supporteurs : "+participantLabels(w, view.supporters)+".")
	}
	r.Records = append(r.Records, stampsOf(view.participations())...)
	if comments > 0 {
		r.Details = append(r.Details, upperFirst(plural(comments, "commentaire", "commentaires"))+".")
	}
	if offers > 0 {
		r.Details = append(r.Details, upperFirst(plural(offers, "offre", "offres"))+" de covoiturage ou de logement, avec leurs places.")
	}
	r.Message = fmt.Sprintf("Supprimer la course « %s » (%s, %s) supprime aussi tout ce qu'elle contient : %s, %s, %s et %s de covoiturage ou de logement.",
		event.Name, days(event.StartDate, event.EndDate), event.Location,
		plural(len(view.formats), "épreuve", "épreuves"), plural(len(view.participations()), "participation", "participations"),
		plural(comments, "commentaire", "commentaires"), plural(offers, "offre", "offres"))

	proceed, out, notice, err := t.guard(ctx, "delete_event", struct{ Event string }{id}, &r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, deleteEventOut{writeStatus: notDoneOut(out, notice)}, nil
	}
	if err := t.inner.send(ctx, http.MethodDelete, "/api/collections/events/records/"+id, nil, nil); err != nil {
		return fail(err)
	}
	return nil, deleteEventOut{
		writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("La course « %s » est supprimée, avec %s, %s, %s et %s.", event.Name,
			plural(len(view.formats), "épreuve", "épreuves"), plural(len(view.participations()), "participation", "participations"),
			plural(comments, "commentaire", "commentaires"), plural(offers, "offre", "offres"))},
		Removed: &removedEvent{ID: event.ID, Name: event.Name, StartDate: event.StartDate},
	}, nil
}
