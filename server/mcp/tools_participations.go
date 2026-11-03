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
	"unicode"
	"unicode/utf8"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has the tools of the participations (spec § 6.6): add_participation,
// update_participation and remove_participation. The result of a race is a change
// of its participation too: set_result is in tools_results.go, and shares what is
// here. Each tool is written as « The pattern of a write tool » says. Who may do
// what is the site's: the rules of the collection and the hooks of the
// participations package decide. A tool announces a refusal that it knows the site
// will give, and writes nothing then; it never allows what the site refuses.

// participationStatuses are the six statuses of a participation, as the site names
// them (« Intéressé » to « Supporteur »).
var participationStatuses = []string{"interested", "registered", "finished", "dnf", "dns", "supporter"}

// participationResult is what the tools that add or change a participation answer
// (spec § 6.6): done and the participation as get_event gives it, or, when
// nothing was done for want of the person's agreement, the confirmation to ask for.
type participationResult struct {
	Done          bool              `json:"done" jsonschema:"vrai quand c'est fait ; faux quand rien n'a été fait : summary dit pourquoi, et confirmation ce qu'il faut demander à la personne"`
	Confirmation  *confirmationOut  `json:"confirmation,omitempty" jsonschema:"quand rien n'a été fait faute d'accord : ce qui serait perdu ou changé, et le jeton à redonner si la personne accepte"`
	Participation *participationOut `json:"participation,omitempty" jsonschema:"la participation, comme get_event la donne ; confirmed y dit si son coureur l'a confirmée"`
	Event         *eventRef         `json:"event,omitempty" jsonschema:"la course"`
	FormatTitle   string            `json:"format_title,omitempty" jsonschema:"l'épreuve, comme le site l'écrit ; absent pour une participation à la course seule (intéressé sans épreuve, supporteur)"`
	Summary       string            `json:"summary,omitempty" jsonschema:"ce qui a été fait, ou pourquoi rien ne l'a été, en une phrase"`
}

// removeParticipationResult is the answer of remove_participation: the
// participation that is gone.
type removeParticipationResult struct {
	Done         bool              `json:"done" jsonschema:"vrai quand c'est fait ; faux quand rien n'a été fait : summary dit pourquoi, et confirmation ce qu'il faut demander à la personne"`
	Confirmation *confirmationOut  `json:"confirmation,omitempty" jsonschema:"quand rien n'a été fait faute d'accord : ce qui serait perdu, et le jeton à redonner si la personne accepte"`
	Removed      *participationOut `json:"removed,omitempty" jsonschema:"la participation qui n'existe plus"`
	Event        *eventRef         `json:"event,omitempty" jsonschema:"la course"`
	FormatTitle  string            `json:"format_title,omitempty" jsonschema:"l'épreuve, comme le site l'écrit ; absent pour une participation à la course seule"`
	Summary      string            `json:"summary,omitempty" jsonschema:"ce qui a été fait, ou pourquoi rien ne l'a été, en une phrase"`
}

var (
	participationSchema = sync.OnceValue(writeSchema[participationResult])
	removedSchema       = sync.OnceValue(writeSchema[removeParticipationResult])
)

// ---------------------------------------------------------------------------
// What the tools share

// participationIDOf is the id of a participation that a tool was given, without the
// blanks around it, or the refusal that says what is wrong with it.
func participationIDOf(input string) (string, error) {
	id := strings.TrimSpace(input)
	switch {
	case id == "":
		return "", errors.New("Il manque l'identifiant de la participation (participation_id) : get_event donne ceux des participations d'une course.")
	case !isID(id):
		return "", fmt.Errorf("« %s » n'est pas un identifiant de participation : get_event donne ceux des participations d'une course.", id)
	}
	return id, nil
}

// participationPath is the path of a participation with what the answer needs to
// say: its runner, who added it, its event and its race.
func participationPath(id string) string {
	return "/api/collections/participations/records/" + id + "?" + url.Values{"expand": {homeExpand}}.Encode()
}

// participationForWrite is the participation that a tool changes or removes, with
// what it is on.
func (t *tools) participationForWrite(ctx context.Context, id string) (participationRow, error) {
	var record participationRecord
	if err := t.inner.get(ctx, participationPath(id), &record); err != nil {
		return participationRow{}, err
	}
	return newRow(record, runnerRecord{})
}

// owns reports whether the participation is the caller's own: its runner is the one
// of the caller's account.
func (c *caller) owns(r participationRow) bool {
	return r.Runner.User != "" && r.Runner.User == c.user.Id
}

// confirmedRefusal is the refusal that the site gives to a member who changes or
// removes (what is « changée », « retirée ») the participation of somebody else
// once that runner confirmed it: the rule of the update and the deletion is that an
// admin, the runner or anybody while it is not confirmed may. nil when the caller
// may. The words never infer, from a name, how to speak of a person: nothing
// agrees with the runner.
func confirmedRefusal(c *caller, r participationRow, what string) error {
	if c.role == roleAdmin || c.owns(r) || !r.Participation.Confirmed {
		return nil
	}
	name := r.Runner.Name
	return fmt.Errorf("%s a confirmé cette participation : elle ne peut plus être %s que par %s ou par un admin.", name, what, name)
}

// placeOf says where a participation is: its race and its event, or the event
// alone.
func placeOf(w wording.Words, r participationRow) string {
	if r.Participation.Format == "" {
		return quote(r.Event.Name) + " (course seule)"
	}
	return quote(r.formatTitle(w)) + " (" + plain(r.Event.Name) + ")"
}

// ofName writes de before a name, elided before a vowel or a mute h: « de Bob »,
// « d'Alice », « d'Hélène ». An aspirated h is not told from a mute one: « d'Hugo »
// is what most write.
func ofName(name string) string {
	r, _ := utf8.DecodeRuneInString(name)
	if strings.ContainsRune("aeiouyhàâäéèêëîïôöùûü", unicode.ToLower(r)) {
		return "d'" + name
	}
	return "de " + name
}

// confirmationNote says what the site does of a participation that its runner has
// not confirmed: where they will confirm it, or that they cannot, having no
// account. "" for one that is confirmed.
func confirmationNote(runner runnerRecord, confirmed bool) string {
	switch {
	case confirmed:
		return ""
	case runner.User != "":
		return "non confirmé : " + runner.Name + " le verra dans « À confirmer »"
	}
	return runner.Name + " n'a pas de compte : sa participation reste non confirmée"
}

// sentence joins a head and what goes with it as a sentence: « head ; a ; b. ».
func sentence(head string, parts ...string) string {
	for _, part := range parts {
		if part != "" {
			head += " ; " + part
		}
	}
	return head + "."
}

// participationAnswer is the answer of a tool that did what it was asked, about a
// participation read after it was written.
func (t *tools) participationAnswer(w wording.Words, r participationRow, summary string) participationResult {
	out := r.Participation.out(w)
	event := r.eventRef(t.cfg)
	return participationResult{Done: true, Participation: &out, Event: &event, FormatTitle: r.formatTitle(w), Summary: summary}
}

// resultFields is the result of a participation: its time, its rank and how many were
// ranked, its note (the fields of resultOut, as the site stores them).
type resultFields struct {
	TimeS, Rank, RankOf int
	Note                string
}

// resultOfRecord is the result that a participation holds.
func resultOfRecord(p participationRecord) resultFields {
	return resultFields{TimeS: p.FinishTimeS, Rank: p.Rank, RankOf: p.RankOf, Note: strings.TrimSpace(p.ResultNote)}
}

// parts is what the site writes of the result (wording.ResultParts): none for a
// result that is empty. The number of people ranked alone is not a result.
func (r resultFields) parts(w wording.Words) []string {
	return w.ResultParts(r.TimeS, r.Rank, r.RankOf, r.Note)
}

// kept is the result that stays once the site has applied a status to it: the hook
// of the participations package clears what the status does not go with (clearResult
// there), which is the time, the rank and the number ranked when the status is not
// « finished », and the note when it is neither « finished » nor « dnf ».
// TestTools_UpdateParticipation_NamesWhatTheHookClears checks the two say the same.
func (r resultFields) kept(status string) resultFields {
	if status != statusFinished {
		r.TimeS, r.Rank, r.RankOf = 0, 0, 0
	}
	if status != statusFinished && status != statusDNF {
		r.Note = ""
	}
	return r
}

// lostBy is what of the result a status clears.
func (r resultFields) lostBy(status string) resultFields {
	kept := r.kept(status)
	var lost resultFields
	if kept.TimeS == 0 {
		lost.TimeS = r.TimeS
	}
	if kept.Rank == 0 {
		lost.Rank, lost.RankOf = r.Rank, r.RankOf
	}
	if kept.Note == "" {
		lost.Note = r.Note
	}
	return lost
}

// The statuses that a result goes with.
const (
	statusFinished = "finished"
	statusDNF      = "dnf"
)

// ---------------------------------------------------------------------------
// add_participation

type addParticipationIn struct {
	Runner       string `json:"runner,omitempty" jsonschema:"l'identifiant ou le nom d'un coureur (list_runners les donne) ; sans lui, la personne au nom de qui tu agis"`
	EventID      string `json:"event_id,omitempty" jsonschema:"l'identifiant de la course, tel que search_events le donne ; obligatoire sans format_id"`
	FormatID     string `json:"format_id,omitempty" jsonschema:"l'identifiant de l'épreuve, tel que get_event le donne ; sans lui, une participation à la course seule"`
	Status       string `json:"status" jsonschema:"obligatoire, sans valeur par défaut : interested (Intéressé), registered (Inscrit sur le site officiel), finished (Terminé) et dnf (Abandon) à partir du jour de l'épreuve, dns (Non partant) ou supporter (vient encourager, sans épreuve). « Inscrire » est ambigu (Intéressé ou Inscrit ?) : la personne choisit, demande-lui"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var addParticipationSchema = sync.OnceValue(func() *jsonschema.Schema {
	return inputSchema[addParticipationIn](map[string][]string{"status": participationStatuses})
})

func addAddParticipation(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "add_participation",
		Title: "Ajouter une participation",
		Description: "Ajoute un coureur à une course : « J'y vais » (sans runner : la personne au nom de qui tu agis), « Ajouter quelqu'un » (un autre coureur du groupe) ou « Je viens encourager » (supporter). " +
			"Donne l'épreuve avec format_id ; sans elle, c'est la participation à la course seule (event_id), seulement interested (format à choisir ; refusé quand la course n'a qu'une épreuve) ou supporter. " +
			"Une participation à une épreuve remplace celle du même coureur à la course seule : pour un autre coureur que la personne, rien n'est fait au premier appel, qui le dit et donne un jeton de confirmation. " +
			"Ajouter un autre coureur crée une participation non confirmée (confirmed: false) : il la confirme lui-même sur le site (« À confirmer »), s'il a un compte. " +
			"Ne la présente pas comme un fait acquis. Demande à la personne avant d'inscrire d'autres coureurs qu'elle-même, et quel statut choisir.",
		InputSchema:  addParticipationSchema(),
		OutputSchema: participationSchema(),
		Annotations:  writeAnnotations(true, false),
	}, usesUpConfirmation(t, t.addParticipation))
}

func (t *tools) addParticipation(ctx context.Context, _ *mcpsdk.CallToolRequest, in addParticipationIn) (*mcpsdk.CallToolResult, participationResult, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, participationResult, error) {
		return nil, participationResult{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, participationResult, error) {
		return nil, participationResult{}, err
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}

	// What was asked, as ids.
	status := strings.TrimSpace(in.Status)
	eventID, formatID := strings.TrimSpace(in.EventID), strings.TrimSpace(in.FormatID)
	if eventID == "" && formatID == "" {
		return refuse(errors.New("Il manque la course : donne event_id, ou format_id."))
	}
	if eventID != "" {
		if eventID, err = eventIDOf(eventID); err != nil {
			return refuse(err)
		}
	}
	if formatID != "" {
		if formatID, err = formatIDOf(formatID); err != nil {
			return refuse(err)
		}
	}
	runners, err := t.runners(ctx)
	if err != nil {
		return fail(err)
	}
	me := runnerOfAccount(runners, c.user.Id)
	runner, err := resolveRunner(runners, in.Runner, me)
	if err != nil {
		return refuse(err)
	}

	// The race: the one of the format, which must be the one given.
	if formatID != "" {
		var format formatRecord
		if err := t.inner.get(ctx, "/api/collections/formats/records/"+formatID, &format); err != nil {
			return fail(err)
		}
		if eventID != "" && eventID != format.Event {
			return refuse(errors.New(fieldText("format", "format_other_event")))
		}
		eventID = format.Event
	}
	view, err := t.eventForWrite(ctx, eventID)
	if err != nil {
		return fail(err)
	}
	w := wording.Of("fr")
	title := ""
	if formatID != "" {
		i := slices.IndexFunc(view.formats, func(f formatView) bool { return f.record.ID == formatID })
		if i < 0 {
			// Read between two writes of somebody else: not there any more.
			return fail(errNotFound)
		}
		title = view.formats[i].title(w)
	}

	// What the runner has on the race already: on this race (nothing to add), or on
	// the event alone (which a race replaces).
	var existing, replaced *participationRecord
	for _, p := range view.participations() {
		if p.Runner != runner.ID {
			continue
		}
		switch {
		case p.Format == formatID:
			existing = &p
		case p.Format == "":
			replaced = &p
		}
	}
	if existing != nil {
		target := "la course seule " + quote(view.record.Name)
		if formatID != "" {
			target = quote(title)
		}
		return refuse(fmt.Errorf("%s a déjà une participation à %s (%s, id %s) : change-la avec update_participation.",
			runner.Name, target, w.Status(existing.Status), existing.ID))
	}
	// The site does not offer « Intéressé, format à choisir » for a race that has
	// one format only: there is nothing to choose.
	if formatID == "" && status == "interested" && len(view.formats) == 1 {
		only := view.formats[0]
		return refuse(fmt.Errorf("Cette course n'a qu'une épreuve (%s, id %s) : ajoute le coureur à cette épreuve.", quote(only.title(w)), only.record.ID))
	}

	// The risk: a participation to a race replaces the one of the same runner to the
	// event alone. For somebody else, that is somebody else's choice.
	var r *risk
	if formatID != "" && replaced != nil && runner.ID != me {
		detail := participantLabel(w, *replaced) + " : participation à la course seule " + quote(view.record.Name)
		if by := replaced.Expand.AddedBy.Name; by != "" {
			detail += ", ajoutée par " + by
		}
		detail += ", remplacée par une participation à " + quote(title) + " (" + w.Status(status) + ")."
		r = &risk{
			Message: fmt.Sprintf("Ajouter %s à %s remplace sa participation à la course seule. %s", runner.Name, quote(title), detail),
			Details: []string{detail},
			Records: stampsOf([]participationRecord{*replaced}),
		}
	}
	args := struct{ Runner, Event, Format, Status string }{runner.ID, eventID, formatID, status}
	proceed, out, notice, err := t.guard(ctx, "add_participation", args, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, participationResult{Summary: notDone(out, notice), Confirmation: out}, nil
	}

	body := map[string]any{"runner": runner.ID, "event": eventID, "status": status}
	if formatID != "" {
		body["format"] = formatID
	}
	var created participationRecord
	if err := t.inner.send(ctx, http.MethodPost, "/api/collections/participations/records?"+url.Values{"expand": {homeExpand}}.Encode(), body, &created); err != nil {
		return fail(err)
	}
	row, err := newRow(created, runnerRecord{})
	if err != nil {
		return fail(err)
	}

	head := fmt.Sprintf("Participation %s ajoutée à %s, statut %s", ofName(row.Runner.Name), placeOf(w, row), w.Status(row.Participation.Status))
	replacement := ""
	if replaced != nil {
		replacement = "sa participation à la course seule " + quote(view.record.Name) + " (" + w.Status(replaced.Status) + ") est remplacée"
	}
	summary := sentence(head, replacement, confirmationNote(row.Runner, row.Participation.Confirmed))
	return nil, t.participationAnswer(w, row, summary), nil
}

func (in addParticipationIn) confirmationGiven() string { return in.Confirmation }

// ---------------------------------------------------------------------------
// update_participation

type updateParticipationIn struct {
	ParticipationID string `json:"participation_id" jsonschema:"l'identifiant de la participation, tel que get_event le donne"`
	Status          string `json:"status,omitempty" jsonschema:"le nouveau statut : interested (Intéressé), registered (Inscrit), finished (Terminé) et dnf (Abandon) à partir du jour de l'épreuve, dns (Non partant) ou supporter (sans épreuve)"`
	FormatID        string `json:"format_id,omitempty" jsonschema:"une épreuve de la même course : choisir celle d'un « Intéressé, format à choisir », ou changer d'épreuve"`
	Confirmation    string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var updateParticipationSchema = sync.OnceValue(func() *jsonschema.Schema {
	return inputSchema[updateParticipationIn](map[string][]string{"status": participationStatuses})
})

func addUpdateParticipation(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "update_participation",
		Title: "Modifier une participation",
		Description: "Change le statut ou l'épreuve d'une participation, comme son menu sur le site. " +
			"Sans status ni format_id, elle confirme la participation (« Confirmer » de l'accueil), ce que seul son coureur peut faire. " +
			"Toute modification par le coureur lui-même la confirme ; celle d'un autre coureur la laisse non confirmée. " +
			"Un coureur qui a confirmé sa participation est le seul, avec les admins, à pouvoir la changer. " +
			"Changer la participation d'un autre coureur, ou un statut qui effacerait un résultat (le temps, le classement et la note ne vont qu'avec Terminé et Abandon) " +
			"n'est fait qu'au second appel, avec le jeton de confirmation que le premier donne.",
		InputSchema:  updateParticipationSchema(),
		OutputSchema: participationSchema(),
		Annotations:  writeAnnotations(true, true),
	}, usesUpConfirmation(t, t.updateParticipation))
}

func (t *tools) updateParticipation(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateParticipationIn) (*mcpsdk.CallToolResult, participationResult, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, participationResult, error) {
		return nil, participationResult{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, participationResult, error) {
		return nil, participationResult{}, err
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	id, err := participationIDOf(in.ParticipationID)
	if err != nil {
		return refuse(err)
	}
	status, formatID := strings.TrimSpace(in.Status), strings.TrimSpace(in.FormatID)
	if formatID != "" {
		if formatID, err = formatIDOf(formatID); err != nil {
			return refuse(err)
		}
	}
	row, err := t.participationForWrite(ctx, id)
	if err != nil {
		return fail(err)
	}
	w := wording.Of("fr")
	p := row.Participation
	own := c.owns(row)

	// Neither a status nor a race: it is the confirmation of the participation, which
	// only its runner gives.
	confirming := status == "" && formatID == ""
	if confirming && !own {
		return refuse(fmt.Errorf("Seule la personne concernée, %s, peut confirmer sa participation.", row.Runner.Name))
	}
	if err := confirmedRefusal(c, row, "changée"); err != nil {
		return refuse(err)
	}

	// The race that it moves to: of the same event (the site refuses another).
	var moved formatRecord
	if formatID != "" && formatID != p.Format {
		if err := t.inner.get(ctx, "/api/collections/formats/records/"+formatID+"?"+url.Values{"expand": {"race_type"}}.Encode(), &moved); err != nil {
			return fail(err)
		}
		if moved.Event != row.Event.ID {
			return refuse(errors.New(fieldText("format", "format_other_event")))
		}
	}

	// What changes: only what differs from what is stored is written.
	body := map[string]any{}
	if status != "" && status != p.Status {
		body["status"] = status
	}
	if moved.ID != "" {
		body["format"] = moved.ID
	}
	if len(body) == 0 && (!own || p.Confirmed) {
		if confirming {
			return nil, t.participationAnswer(w, row, fmt.Sprintf("Rien à changer : la participation %s à %s est déjà confirmée.", ofName(row.Runner.Name), placeOf(w, row))), nil
		}
		return nil, t.participationAnswer(w, row, fmt.Sprintf("Rien à changer : la participation %s à %s est déjà ainsi (statut %s).", ofName(row.Runner.Name), placeOf(w, row), w.Status(p.Status))), nil
	}

	// The risk: somebody else's participation, and the result that the new status
	// clears.
	next := p.Status
	if status != "" {
		next = status
	}
	var details []string
	records := []stamp{{Collection: "participations", ID: p.ID, Updated: p.Updated}}
	if !own {
		line := "C'est la participation d'un autre coureur : " + participantLabel(w, p) + ", à " + placeOf(w, row)
		if by := p.Expand.AddedBy.Name; by != "" {
			line += ", ajoutée par " + by
		}
		details = append(details, line+".")
	}
	if _, ok := body["status"]; ok {
		details = append(details, fmt.Sprintf("Le statut passerait de « %s » à « %s ».", w.Status(p.Status), w.Status(status)))
	}
	if moved.ID != "" {
		movedTitle := formatView{record: moved, raceType: moved.Expand.RaceType}.title(w)
		if p.Format == "" {
			details = append(details, fmt.Sprintf("La participation passerait de la course seule à l'épreuve %s.", quote(movedTitle)))
		} else {
			details = append(details, fmt.Sprintf("L'épreuve passerait de %s à %s.", quote(row.formatTitle(w)), quote(movedTitle)))
		}
		records = append(records, stamp{Collection: "formats", ID: moved.ID, Updated: moved.Updated})
	}
	lost := resultOfRecord(p).lostBy(next).parts(w)
	if len(lost) > 0 {
		details = append(details, "Le résultat serait effacé : "+plain(strings.Join(lost, wording.Separator))+".")
	}
	var r *risk
	if !own || len(lost) > 0 {
		r = &risk{Message: "Cette modification touche ce qu'une personne a saisi : " + strings.Join(details, " "), Details: details, Records: records}
	}

	args := struct{ Participation, Status, Format string }{id, status, formatID}
	proceed, out, notice, err := t.guard(ctx, "update_participation", args, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, participationResult{Summary: notDone(out, notice), Confirmation: out}, nil
	}

	var updated participationRecord
	if err := t.inner.send(ctx, http.MethodPatch, participationPath(id), body, &updated); err != nil {
		return fail(err)
	}
	after, err := newRow(updated, runnerRecord{})
	if err != nil {
		return fail(err)
	}
	verb := "modifiée"
	if len(body) == 0 {
		verb = "confirmée"
	}
	head := fmt.Sprintf("Participation %s à %s %s, statut %s", ofName(after.Runner.Name), placeOf(w, after), verb, w.Status(after.Participation.Status))
	return nil, t.participationAnswer(w, after, sentence(head, confirmationNote(after.Runner, after.Participation.Confirmed))), nil
}

func (in updateParticipationIn) confirmationGiven() string { return in.Confirmation }

// ---------------------------------------------------------------------------
// remove_participation

type removeParticipationIn struct {
	ParticipationID string `json:"participation_id" jsonschema:"l'identifiant de la participation, tel que get_event le donne"`
	Confirmation    string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func addRemoveParticipation(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "remove_participation",
		Title: "Retirer une participation",
		Description: "Supprime une participation : c'est la désinscription du site (« Retirer »). " +
			"Le premier appel ne fait rien : il dit le coureur, l'épreuve, le statut et le résultat qui serait perdu, et donne un jeton de confirmation. " +
			"Pour quelqu'un qui ne prend pas le départ d'une course où il était inscrit, préfère le statut dns (Non partant) avec update_participation : la trace reste. " +
			"Les droits sont ceux du site : un admin, le coureur lui-même, ou n'importe qui tant que le coureur n'a pas confirmé sa participation.",
		InputSchema:  inputSchema[removeParticipationIn](nil),
		OutputSchema: removedSchema(),
		Annotations:  writeAnnotations(true, false),
	}, usesUpConfirmation(t, t.removeParticipation))
}

func (t *tools) removeParticipation(ctx context.Context, _ *mcpsdk.CallToolRequest, in removeParticipationIn) (*mcpsdk.CallToolResult, removeParticipationResult, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, removeParticipationResult, error) {
		return nil, removeParticipationResult{}, describe(t.app, err, nil)
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	id, err := participationIDOf(in.ParticipationID)
	if err != nil {
		return nil, removeParticipationResult{}, err
	}
	row, err := t.participationForWrite(ctx, id)
	if err != nil {
		return fail(err)
	}
	if err := confirmedRefusal(c, row, "retirée"); err != nil {
		return nil, removeParticipationResult{}, err
	}

	// Always asked: the participation goes, with its result.
	w := wording.Of("fr")
	p := row.Participation
	line := participantLabel(w, p) + ", à " + placeOf(w, row)
	if by := p.Expand.AddedBy.Name; by != "" {
		line += ", ajoutée par " + by
	}
	r := &risk{Details: []string{line + "."}, Records: []stamp{{Collection: "participations", ID: p.ID, Updated: p.Updated}}}
	if len(resultOfRecord(p).parts(w)) > 0 {
		r.Details = append(r.Details, "Le résultat saisi serait perdu.")
	}
	r.Message = "Retirer cette participation la supprime : " + strings.Join(r.Details, " ")

	proceed, out, notice, err := t.guard(ctx, "remove_participation", struct{ Participation string }{id}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, removeParticipationResult{Summary: notDone(out, notice), Confirmation: out}, nil
	}
	if err := t.inner.send(ctx, http.MethodDelete, "/api/collections/participations/records/"+id, nil, nil); err != nil {
		return fail(err)
	}

	removed := p.out(w)
	event := row.eventRef(t.cfg)
	summary := fmt.Sprintf("Participation %s à %s retirée.", ofName(row.Runner.Name), placeOf(w, row))
	return nil, removeParticipationResult{Done: true, Removed: &removed, Event: &event, FormatTitle: row.formatTitle(w), Summary: summary}, nil
}

func (in removeParticipationIn) confirmationGiven() string { return in.Confirmation }
