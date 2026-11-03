package mcp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has the tools that write a race as a whole (spec § 6.5):
// create_event, update_event and delete_event. Each is written as « The pattern
// of a write tool » says: it reads, normalizes its input, announces the refusals
// that the site would give, computes its risk, goes through guard, writes in one
// request, and reads again. What they share with the tools of the formats is in
// race_writes.go, and what every write tool shares in writes.go.

// maxFormats is the most formats that a race is created with: the batch of the
// site takes 50 requests, and a race of 20 formats is far from that.
const maxFormats = 20

// The participation statuses of « Je participe » (STATUSES of the site): the
// ones of a participation on a format.
var formatStatuses = []string{"interested", "registered", "finished", "dnf", "dns"}

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
	}, usesUpConfirmation(t, t.createEvent))
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
	if err := dateRefusal(w, draft, labels, startHint); err != nil {
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

	summary := fmt.Sprintf("La course %s est créée (%s, %s), avec %s.", quote(draft.Name), days(draft.StartDate, draft.EndDate), quote(draft.Location),
		plural(len(draft.Formats), "épreuve", "épreuves"))
	if draft.Join != nil {
		summary += fmt.Sprintf(" %s participe à %s (%s).", plain(me.Name), quote(titleOf(w, draft.Formats[draft.Join.FormatIndex], labels)), w.Status(draft.Join.Status))
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
		r.Details = append(r.Details, fmt.Sprintf("%s (%s, %s, %s, id %s)", quote(s.Name), days(s.StartDate, s.EndDate), quote(s.Location),
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
	}, usesUpConfirmation(t, t.updateEvent))
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
	// The start is required, as the field of the form is: the days of the
	// formats are read from it.
	if args.StartDate != nil && *args.StartDate == "" {
		return nil, eventWriteOut{}, errors.New("start_date ne s'efface pas : une course a toujours un premier jour (AAAA-MM-JJ).")
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
		return fmt.Sprintf("La course %s est modifiée (%s, %s).", quote(draft.Name), days(draft.StartDate, draft.EndDate), quote(draft.Location))
	}
	answer, err := t.changeEvent(ctx, "update_event", view, labels, args, strings.TrimSpace(in.Confirmation), change, nil, summary)
	return nil, answer, err
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
	}, usesUpConfirmation(t, t.deleteEvent))
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
		line := "Épreuve " + quote(f.title(w))
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
	// The message names who would lose a place, and not only how many: it is
	// what the assistant shows the person.
	who := strings.Join(r.Details, " ")
	if comments > 0 {
		r.Details = append(r.Details, upperFirst(plural(comments, "commentaire", "commentaires"))+".")
	}
	if offers > 0 {
		r.Details = append(r.Details, upperFirst(plural(offers, "offre", "offres"))+" de covoiturage ou de logement, avec leurs places.")
	}
	r.Message = fmt.Sprintf("Supprimer la course %s (%s, %s) supprime aussi tout ce qu'elle contient : %s, %s, %s et %s de covoiturage ou de logement. %s",
		quote(event.Name), days(event.StartDate, event.EndDate), quote(event.Location),
		plural(len(view.formats), "épreuve", "épreuves"), plural(len(view.participations()), "participation", "participations"),
		plural(comments, "commentaire", "commentaires"), plural(offers, "offre", "offres"), who)

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
		writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("La course %s est supprimée, avec %s, %s, %s et %s.", quote(event.Name),
			plural(len(view.formats), "épreuve", "épreuves"), plural(len(view.participations()), "participation", "participations"),
			plural(comments, "commentaire", "commentaires"), plural(offers, "offre", "offres"))},
		Removed: &removedEvent{ID: event.ID, Name: event.Name, StartDate: event.StartDate},
	}, nil
}

func (in createEventIn) confirmationGiven() string { return in.Confirmation }
func (in updateEventIn) confirmationGiven() string { return in.Confirmation }
func (in deleteEventIn) confirmationGiven() string { return in.Confirmation }
