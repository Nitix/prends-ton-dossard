package mcp

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has the tools of the formats of a race (spec § 6.5): add_format,
// update_format and delete_format. Each writes the race as the form does, in
// one batch (changeEvent): a format moved, added or removed moves the end of
// its race with it.

// ---------------------------------------------------------------------------
// add_format

type addFormatIn struct {
	EventID string `json:"event_id" jsonschema:"l'identifiant de la course, tel que search_events le donne"`
	formatIn
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var addFormatSchema = sync.OnceValue(func() *jsonschema.Schema {
	return withMinimum(inputSchema[addFormatIn](nil), 0, formatNumbers...)
})

func addAddFormat(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "add_format",
		Title: "Ajouter une épreuve",
		Description: "Ajoute une épreuve à une course, comme « Ajouter une épreuve » du formulaire (tout membre le peut). " +
			"Elle a au moins une mesure, distance_km, duration_min ou time_limit_min : de préférence celles de son type (list_race_types). " +
			"La fin de la course vient de ses épreuves : une épreuve datée après la fin l'allonge, dans la même écriture. " +
			"Une course dont le dernier jour ne vient d'aucune épreuve serait raccourcie : rien n'est fait au premier appel, " +
			"qui le dit et donne un jeton de confirmation. Donne la course comme get_event.",
		InputSchema:  addFormatSchema(),
		OutputSchema: eventWriteSchema(),
		Annotations:  writeAnnotations(true, false),
	}, usesUpConfirmation(t, t.addFormat))
}

func (t *tools) addFormat(ctx context.Context, _ *mcpsdk.CallToolRequest, in addFormatIn) (*mcpsdk.CallToolResult, eventWriteOut, error) {
	id, err := eventIDOf(in.EventID)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	view, err := t.eventForWrite(ctx, id)
	if err != nil {
		return nil, eventWriteOut{}, describe(t.app, err, nil)
	}
	raceTypes, err := t.raceTypes(ctx)
	if err != nil {
		return nil, eventWriteOut{}, describe(t.app, err, nil)
	}
	added, err := normalizeFormat(in.formatIn, raceTypes)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	labels := labelsOf(view, raceTypes)
	w := wording.Of("fr")

	change := func(draft *eventDraft) { draft.Formats = append(draft.Formats, added) }
	summary := func(draft eventDraft) string {
		return fmt.Sprintf("L'épreuve %s est ajoutée à %s (%s).", quote(titleOf(w, added, labels)), quote(draft.Name), days(draft.StartDate, draft.EndDate))
	}
	args := struct {
		Event  string
		Format formatDraft
	}{id, added}
	answer, err := t.changeEvent(ctx, "add_format", view, labels, args, strings.TrimSpace(in.Confirmation), change, nil, summary)
	return nil, answer, err
}

// ---------------------------------------------------------------------------
// update_format

type updateFormatIn struct {
	formatPatchIn
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var updateFormatSchema = sync.OnceValue(func() *jsonschema.Schema {
	return withMinimum(inputSchema[updateFormatIn](nil), 0, formatNumbers...)
})

func addUpdateFormat(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "update_format",
		Title: "Modifier une épreuve",
		Description: "Modifie une épreuve, comme une épreuve du formulaire « Modifier » (tout membre le peut) : c'est update_event avec une seule épreuve. " +
			"Un champ absent ne change pas ; 0 ou un texte vide l'efface. Une épreuve déplacée après la fin de la course l'allonge, dans la même écriture. " +
			"Un champ vidé, ou le jour d'une épreuve qui a des participants, ou une course raccourcie, " +
			"n'est fait qu'au second appel, avec le jeton de confirmation que le premier donne. Donne la course comme get_event.",
		InputSchema:  updateFormatSchema(),
		OutputSchema: eventWriteSchema(),
		Annotations:  writeAnnotations(true, true),
	}, usesUpConfirmation(t, t.updateFormat))
}

func (t *tools) updateFormat(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateFormatIn) (*mcpsdk.CallToolResult, eventWriteOut, error) {
	formatID, err := formatIDOf(in.FormatID)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	view, err := t.eventOfFormat(ctx, formatID)
	if err != nil {
		return nil, eventWriteOut{}, describe(t.app, err, nil)
	}
	var raceTypes []raceTypeRecord
	if in.RaceType != nil {
		if raceTypes, err = t.raceTypes(ctx); err != nil {
			return nil, eventWriteOut{}, describe(t.app, err, nil)
		}
	}
	in.FormatID = formatID
	patches, err := normalizePatches(view, []formatPatchIn{in.formatPatchIn}, raceTypes)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	labels := labelsOf(view, raceTypes)
	w := wording.Of("fr")

	change := func(draft *eventDraft) { applyPatches(draft, patches) }
	summary := func(draft eventDraft) string {
		i := slices.IndexFunc(draft.Formats, func(f formatDraft) bool { return f.ID == formatID })
		return fmt.Sprintf("L'épreuve %s de %s est modifiée (la course : %s).", quote(titleOf(w, draft.Formats[i], labels)), quote(draft.Name), days(draft.StartDate, draft.EndDate))
	}
	answer, err := t.changeEvent(ctx, "update_format", view, labels, patches[0], strings.TrimSpace(in.Confirmation), change, nil, summary)
	return nil, answer, err
}

// ---------------------------------------------------------------------------
// delete_format

type deleteFormatIn struct {
	FormatID     string `json:"format_id" jsonschema:"l'identifiant de l'épreuve, tel que get_event le donne"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func addDeleteFormat(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "delete_format",
		Title: "Supprimer une épreuve",
		Description: "Supprime une épreuve d'une course, comme « Retirer » du formulaire : ses participations et sa trace partent avec elle, et la fin de la course suit. " +
			"Seuls la personne qui a créé la course et les admins le peuvent, et une course garde au moins une épreuve. " +
			"Le premier appel ne fait rien : il dit ce qui serait perdu et donne un jeton de confirmation. Donne la course comme get_event.",
		InputSchema:  inputSchema[deleteFormatIn](nil),
		OutputSchema: eventWriteSchema(),
		Annotations:  writeAnnotations(true, false),
	}, usesUpConfirmation(t, t.deleteFormat))
}

func (t *tools) deleteFormat(ctx context.Context, _ *mcpsdk.CallToolRequest, in deleteFormatIn) (*mcpsdk.CallToolResult, eventWriteOut, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, eventWriteOut, error) {
		return nil, eventWriteOut{}, describe(t.app, err, nil)
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	formatID, err := formatIDOf(in.FormatID)
	if err != nil {
		return nil, eventWriteOut{}, err
	}
	view, err := t.eventOfFormat(ctx, formatID)
	if err != nil {
		return fail(err)
	}
	i := slices.IndexFunc(view.formats, func(f formatView) bool { return f.record.ID == formatID })
	if i < 0 {
		// Read between two writes of somebody else: not there any more.
		return fail(errNotFound)
	}
	if err := authorRefusal(c, view, "supprimer une de ses épreuves"); err != nil {
		return nil, eventWriteOut{}, err
	}
	if len(view.formats) == 1 {
		return nil, eventWriteOut{}, errors.New("Une course garde au moins une épreuve.")
	}

	w := wording.Of("fr")
	format := view.formats[i]
	title, event := format.title(w), view.record
	change := func(draft *eventDraft) {
		draft.Formats = slices.DeleteFunc(draft.Formats, func(f formatDraft) bool { return f.ID == formatID })
	}

	// What goes with it: its participations, its track, and the days of the race
	// it was the last of.
	r := risk{Records: append([]stamp{{Collection: "formats", ID: format.record.ID, Updated: format.record.Updated}}, stampsOf(format.participations)...)}
	r.Message = "Supprimer l'épreuve " + quote(title) + " (" + quote(event.Name) + ")"
	if n := len(format.participations); n > 0 {
		r.Message += " supprime aussi " + plural(n, "participation", "participations") + " : " + participantLabels(w, format.participations) + "."
		for _, p := range format.participations {
			r.Details = append(r.Details, participantLabel(w, p))
		}
	} else {
		r.Message += " : elle n'a aucun participant."
	}
	if format.record.GPX != "" {
		r.Message += " Sa trace GPX part avec elle."
		r.Details = append(r.Details, "La trace GPX « "+format.record.GPX+" ».")
	}
	draft := draftOf(view)
	change(&draft)
	if end := draft.endDate(); shortens(event.StartDate, event.EndDate, end) {
		line := shortenedLine(event.StartDate, event.EndDate, event.StartDate, end)
		r.Message += " " + line
		r.Details = append(r.Details, line)
		r.Records = append(r.Records, stamp{Collection: "events", ID: event.ID, Updated: event.Updated})
	}

	summary := func(eventDraft) string {
		return fmt.Sprintf("L'épreuve %s est supprimée de %s, avec %s.", quote(title), quote(event.Name),
			plural(len(format.participations), "participation", "participations"))
	}
	answer, err := t.changeEvent(ctx, "delete_format", view, labelsOf(view, nil), struct{ Format string }{formatID},
		strings.TrimSpace(in.Confirmation), change, &r, summary)
	return nil, answer, err
}

func (in addFormatIn) confirmationGiven() string    { return in.Confirmation }
func (in updateFormatIn) confirmationGiven() string { return in.Confirmation }
func (in deleteFormatIn) confirmationGiven() string { return in.Confirmation }
