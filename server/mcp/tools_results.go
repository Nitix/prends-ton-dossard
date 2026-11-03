package mcp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has the tool that enters the result of a race (spec § 6.6): set_result.
// It is one change of the participation, as « Saisir le résultat » of the site is,
// with the rights of update_participation (tools_participations.go).

// parseFinishTime reads the time of a result: "h:mm:ss" (the hours as many digits
// as it takes, up to four; the minutes and the seconds two digits each, below 60),
// or "mm:ss" under an hour. It is in seconds, and more than 0: a time of 0 is a
// time that is not given.
func parseFinishTime(s string) (int, error) {
	s = strings.TrimSpace(s)
	bad := func(why string) error {
		return fmt.Errorf("finish_time : « %s » %s : écris-le h:mm:ss (4:12:30), ou mm:ss sous une heure (45:00).", s, why)
	}
	// digits is the number that the text is, when it is made of min to max digits
	// of 0 to 9 only.
	digits := func(text string, min, max int) (int, bool) {
		if len(text) < min || len(text) > max {
			return 0, false
		}
		for _, r := range text {
			if r < '0' || r > '9' {
				return 0, false
			}
		}
		n, err := strconv.Atoi(text)
		return n, err == nil
	}

	parts := strings.Split(s, ":")
	var hours, minutes, seconds int
	var ok bool
	switch len(parts) {
	case 3:
		if hours, ok = digits(parts[0], 1, 4); !ok {
			return 0, bad("n'est pas un temps")
		}
		if minutes, ok = digits(parts[1], 2, 2); !ok {
			return 0, bad("n'est pas un temps")
		}
		if seconds, ok = digits(parts[2], 2, 2); !ok {
			return 0, bad("n'est pas un temps")
		}
	case 2:
		if minutes, ok = digits(parts[0], 1, 2); !ok {
			return 0, bad("n'est pas un temps")
		}
		if seconds, ok = digits(parts[1], 2, 2); !ok {
			return 0, bad("n'est pas un temps")
		}
	default:
		return 0, bad("n'est pas un temps")
	}
	if minutes > 59 || seconds > 59 {
		return 0, bad("n'est pas un temps")
	}
	total := hours*3600 + minutes*60 + seconds
	if total == 0 {
		return 0, bad("est un temps de zéro, qui n'est pas un temps")
	}
	return total, nil
}

type setResultIn struct {
	ParticipationID string `json:"participation_id" jsonschema:"l'identifiant de la participation, tel que get_event le donne : une participation à une épreuve"`
	Status          string `json:"status" jsonschema:"finished (Terminé) ou dnf (Abandon) ; seulement à partir du jour de l'épreuve"`
	FinishTime      string `json:"finish_time,omitempty" jsonschema:"le temps final, h:mm:ss (4:12:30), ou mm:ss sous une heure : 1:30 est une minute et demie, 1h30 s'écrit 1:30:00 ; avec finished seulement"`
	Rank            int    `json:"rank,omitempty" jsonschema:"le classement général, 1 ou plus ; avec finished seulement, et au plus rank_of"`
	RankOf          int    `json:"rank_of,omitempty" jsonschema:"le nombre de classés, 1 ou plus ; avec finished seulement"`
	Note            string `json:"note,omitempty" jsonschema:"quelques mots (« 3e V1H », « abandon au km 30 »), 200 caractères au plus ; avec finished et dnf"`
	Confirmation    string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

var setResultSchema = sync.OnceValue(func() *jsonschema.Schema {
	schema := inputSchema[setResultIn](map[string][]string{"status": {statusFinished, statusDNF}})
	return withMinimum(schema, 1, "rank", "rank_of")
})

func addSetResult(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "set_result",
		Title: "Saisir un résultat",
		Description: "Saisit le résultat d'une participation à une épreuve, comme « Saisir le résultat » du site : Terminé (finished) avec son temps, son classement et le nombre de classés, ou Abandon (dnf) ; une note dans les deux cas. " +
			"Le résultat est écrit en entier : ce qui n'est pas donné est effacé, et l'ancien est remplacé. Un abandon n'a ni temps ni classement : le site ne les garde pas. " +
			"Seulement à partir du jour de l'épreuve. Les droits sont ceux de update_participation. " +
			"Remplacer un résultat déjà saisi, ou saisir celui d'un autre coureur, n'est fait qu'au second appel, avec le jeton de confirmation que le premier donne.",
		InputSchema:  setResultSchema(),
		OutputSchema: participationSchema(),
		Annotations:  writeAnnotations(true, true),
	}, usesUpConfirmation(t, t.setResult))
}

func (t *tools) setResult(ctx context.Context, _ *mcpsdk.CallToolRequest, in setResultIn) (*mcpsdk.CallToolResult, participationResult, error) {
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
	status := strings.TrimSpace(in.Status)
	given := resultFields{Rank: in.Rank, RankOf: in.RankOf, Note: strings.TrimSpace(in.Note)}
	if strings.TrimSpace(in.FinishTime) != "" {
		if given.TimeS, err = parseFinishTime(in.FinishTime); err != nil {
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
	if err := confirmedRefusal(c, row, "changée"); err != nil {
		return refuse(err)
	}
	if p.Format == "" {
		return refuse(errors.New("Choisis d'abord l'épreuve. Donne-la avec update_participation (format_id)."))
	}

	// What the site stores: the result of the status (the hook clears what it does
	// not go with). Written whole, as the form of the site does.
	stored := given.kept(status)
	old := resultOfRecord(p)
	if p.Status == status && old == stored && (!own || p.Confirmed) {
		return nil, t.participationAnswer(w, row, fmt.Sprintf("Rien à changer : le résultat %s à %s est déjà ainsi (%s).",
			ofName(row.Runner.Name), placeOf(w, row), resultText(w, p))), nil
	}

	// The risk: the result of somebody else's participation, and a result that is
	// replaced: a time, a rank or a note that was entered and is not the new one.
	var details []string
	if !own {
		line := "C'est la participation d'un autre coureur : " + participantLabel(w, p) + ", à " + placeOf(w, row)
		if by := p.Expand.AddedBy.Name; by != "" {
			line += ", ajoutée par " + by
		}
		details = append(details, line+".")
	}
	replaced := (old.TimeS != 0 && stored.TimeS != old.TimeS) ||
		(old.Rank != 0 && (stored.Rank != old.Rank || stored.RankOf != old.RankOf)) ||
		(old.Note != "" && stored.Note != old.Note)
	if replaced {
		next := strings.Join(append([]string{w.Status(status)}, stored.parts(w)...), wording.Separator)
		details = append(details, "Résultat actuel : "+plain(resultText(w, p))+".", "Nouveau résultat : "+plain(next)+".")
	}
	var r *risk
	if len(details) > 0 {
		r = &risk{
			Message: "Cette saisie remplace ou touche ce qu'une personne a saisi : " + strings.Join(details, " "),
			Details: details,
			Records: []stamp{{Collection: "participations", ID: p.ID, Updated: p.Updated}},
		}
	}

	args := struct {
		Participation, Status string
		FinishTimeS           int
		Rank, RankOf          int
		Note                  string
	}{id, status, given.TimeS, given.Rank, given.RankOf, given.Note}
	proceed, out, notice, err := t.guard(ctx, "set_result", args, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, participationResult{Summary: notDone(out, notice), Confirmation: out}, nil
	}

	body := map[string]any{
		"status": status, "finish_time_s": given.TimeS, "rank": given.Rank, "rank_of": given.RankOf, "result_note": given.Note,
	}
	var updated participationRecord
	if err := t.inner.send(ctx, http.MethodPatch, participationPath(id), body, &updated); err != nil {
		return fail(err)
	}
	after, err := newRow(updated, runnerRecord{})
	if err != nil {
		return fail(err)
	}

	head := fmt.Sprintf("Résultat %s enregistré pour %s : %s", ofName(after.Runner.Name), placeOf(w, after), plain(resultText(w, after.Participation)))
	dropped := ""
	if given != stored {
		dropped = "le temps et le classement ne sont pas gardés avec un abandon"
	}
	return nil, t.participationAnswer(w, after, sentence(head, dropped, confirmationNote(after.Runner, after.Participation.Confirmed))), nil
}

func (in setResultIn) confirmationGiven() string { return in.Confirmation }
