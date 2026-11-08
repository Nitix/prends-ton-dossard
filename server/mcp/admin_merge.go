package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has admin_merge (spec § 6.11), the page Doublons of the site: two
// races, or two formats of one race, merged by the site's own routes
// (POST /api/app/admin/merge-events and merge-formats), in its transaction. The
// first call is the site's preview (dryRun), which writes nothing: what it says
// is what the confirmation shows, and part of its state, so that a merge that
// would now do something else is asked again.

// mergeResult is what a merge did, or would do for a dry run: MergeResult of
// server/admin, as the route answers it (its names included).
type mergeResult struct {
	MovedFormats          int `json:"movedFormats" jsonschema:"les épreuves passées sur la course gardée"`
	MovedParticipations   int `json:"movedParticipations" jsonschema:"les participations déplacées"`
	DroppedParticipations int `json:"droppedParticipations" jsonschema:"les participations en double supprimées (un coureur déjà sur ce qui reste)"`
	ClearedFormatDates    int `json:"clearedFormatDates" jsonschema:"les dates d'épreuve effacées, hors des dates de la course gardée"`
	ClearedFormatTimes    int `json:"clearedFormatTimes" jsonschema:"les heures de départ effacées : une course dont seul le mois est connu n'en a pas"`
	MovedComments         int `json:"movedComments" jsonschema:"les commentaires déplacés (une fusion d'épreuves n'en déplace pas)"`
	MovedOffers           int `json:"movedOffers" jsonschema:"les offres de covoiturage et de logement déplacées, avec leurs places (une fusion d'épreuves n'en déplace pas)"`
}

// mergeCounts are the counters of a merge, in the order a merge goes through them,
// with their words (COUNTERS and fr.admin.mergeCount of the site).
var mergeCounts = []struct {
	of         func(mergeResult) int
	one, other string
}{
	{func(r mergeResult) int { return r.MovedFormats }, "épreuve déplacée", "épreuves déplacées"},
	{func(r mergeResult) int { return r.MovedParticipations }, "participation déplacée", "participations déplacées"},
	{func(r mergeResult) int { return r.DroppedParticipations }, "participation en double supprimée", "participations en double supprimées"},
	{func(r mergeResult) int { return r.ClearedFormatDates }, "date d'épreuve effacée (hors des dates de l'événement)", "dates d'épreuve effacées (hors des dates de l'événement)"},
	{func(r mergeResult) int { return r.ClearedFormatTimes }, "heure de départ effacée (la course gardée n'a que son mois)", "heures de départ effacées (la course gardée n'a que son mois)"},
	{func(r mergeResult) int { return r.MovedComments }, "commentaire déplacé", "commentaires déplacés"},
	{func(r mergeResult) int { return r.MovedOffers }, "offre déplacée", "offres déplacées"},
}

// describeMerge ports describeMerge of web/src/features/admin/mergePreview.ts, in
// French: one line per counter that is not zero (« 2 épreuves déplacées »). There
// is none when nothing moves.
func describeMerge(r mergeResult) []string {
	var lines []string
	for _, count := range mergeCounts {
		if n := count.of(r); n > 0 {
			lines = append(lines, plural(n, count.one, count.other))
		}
	}
	return lines
}

// mergeKinds are what a merge is of: its route, and how its records are named.
var mergeKinds = map[string]struct {
	route, missing, kind, list, none, nothing string
}{
	"events": {
		route: "/api/app/admin/merge-events", missing: "de la course", kind: "de course",
		list: "search_events donne ceux des courses", none: "aucune course", nothing: "Rien à déplacer : l'autre course est simplement supprimée.",
	},
	"formats": {
		route: "/api/app/admin/merge-formats", missing: "de l'épreuve", kind: "d'épreuve",
		list: "get_event donne ceux des épreuves d'une course", none: "aucune épreuve", nothing: "Rien à déplacer : l'autre épreuve est simplement supprimée.",
	},
}

type mergeIn struct {
	Kind         string `json:"kind" jsonschema:"events pour deux courses, formats pour deux épreuves d'une même course"`
	KeepID       string `json:"keep_id" jsonschema:"l'identifiant de celle qui reste"`
	MergeID      string `json:"merge_id" jsonschema:"l'identifiant de celle qui est fusionnée dans l'autre, puis supprimée"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel (l'aperçu) a donné, quand la personne a accepté"`
}

func (in mergeIn) confirmationGiven() string { return in.Confirmation }

// mergedRef is what stays of a merge: a race, or a format by its title.
type mergedRef struct {
	ID   string `json:"id"`
	Name string `json:"name" jsonschema:"le nom de la course, ou le titre de l'épreuve comme le site l'écrit"`
}

type mergeOut struct {
	writeStatus
	Result *mergeResult `json:"result,omitempty" jsonschema:"ce que la fusion a fait, comme la route du site le dit"`
	Kept   *mergedRef   `json:"kept,omitempty" jsonschema:"ce qui reste"`
}

var mergeSchema = sync.OnceValue(writeSchema[mergeOut])

func addAdminMerge(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_merge",
		Title: "Fusionner des doublons",
		Description: "Admin → Doublons : deux courses ajoutées chacune par un membre (kind events), ou deux épreuves d'une même course (kind formats), fusionnées en une. " +
			"Ce qui est fusionné (merge_id) passe sur ce qui reste (keep_id) : épreuves, participations, commentaires, covoiturage et logement pour une course ; participations, lien du parcours et trace pour une épreuve. Puis il est supprimé. " +
			"Le premier appel est l'aperçu du site : il ne change rien, et sa confirmation dit ce que la fusion ferait. Le second, avec le jeton, fusionne. " +
			"Si quelque chose change entre les deux (une participation ajoutée), le jeton est refusé et un nouvel aperçu est donné. La fusion est définitive.",
		InputSchema:  inputSchema[mergeIn](map[string][]string{"kind": {"events", "formats"}}),
		OutputSchema: mergeSchema(),
		Annotations:  writeAnnotations(true, false),
	}, adminWrite(t, "admin_merge", t.adminMerge))
}

// mergeSide is one of the two records of a merge, as the confirmation names it.
type mergeSide struct {
	id, name, updated string
	// described is « la course « … » (2026-06-13, Annecy) » or « l'épreuve « … »
	// (…) ».
	described string
}

// mergeSideOf reads one of the two records of a merge; param is the name of its
// argument, for a record that is not there.
func (t *tools) mergeSideOf(ctx context.Context, kind, param, id string) (mergeSide, error) {
	notThere := func(err error) error {
		var refused *apiError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			return fmt.Errorf("%s : %s n'a l'identifiant « %s » (%s).", param, mergeKinds[kind].none, id, mergeKinds[kind].list)
		}
		return describe(t.app, err, nil)
	}
	if kind == "events" {
		var event eventRecord
		query := url.Values{"fields": {"id,name,location,start_date,end_date,updated"}}
		if err := t.inner.get(ctx, "/api/collections/events/records/"+id+"?"+query.Encode(), &event); err != nil {
			return mergeSide{}, notThere(err)
		}
		return mergeSide{
			id: event.ID, name: event.Name, updated: event.Updated,
			described: fmt.Sprintf("la course %s (%s, %s)", quote(event.Name), days(event.StartDate, event.EndDate), quote(event.Location)),
		}, nil
	}
	var format struct {
		formatRecord
		Expand struct {
			RaceType raceTypeRecord `json:"race_type"`
			Event    eventRecord    `json:"event"`
		} `json:"expand"`
	}
	query := url.Values{"expand": {"race_type,event"}}
	if err := t.inner.get(ctx, "/api/collections/formats/records/"+id+"?"+query.Encode(), &format); err != nil {
		return mergeSide{}, notThere(err)
	}
	title := wording.Of("fr").RaceName(format.Name, format.Expand.RaceType.Label, format.DistanceKm, format.DurationMin, format.TimeLimitMin)
	return mergeSide{
		id: format.ID, name: title, updated: format.Updated,
		described: fmt.Sprintf("l'épreuve %s (%s)", quote(title), quote(format.Expand.Event.Name)),
	}, nil
}

func (t *tools) adminMerge(ctx context.Context, _ *mcpsdk.CallToolRequest, in mergeIn) (*mcpsdk.CallToolResult, mergeOut, error) {
	if err := requireAdmin(ctx, "admin_merge"); err != nil {
		return nil, mergeOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, mergeOut, error) {
		return nil, mergeOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, mergeOut, error) {
		return nil, mergeOut{}, err
	}
	kind, ok := mergeKinds[in.Kind]
	if !ok {
		return refuse(errors.New("kind est events ou formats."))
	}
	keepID, err := idOfSomething(in.KeepID, kind.missing+" à garder", kind.kind, "keep_id", kind.list)
	if err != nil {
		return refuse(err)
	}
	mergeID, err := idOfSomething(in.MergeID, kind.missing+" à fusionner", kind.kind, "merge_id", kind.list)
	if err != nil {
		return refuse(err)
	}
	keep, err := t.mergeSideOf(ctx, in.Kind, "keep_id", keepID)
	if err != nil {
		return refuse(err)
	}
	merged, err := t.mergeSideOf(ctx, in.Kind, "merge_id", mergeID)
	if err != nil {
		return refuse(err)
	}

	// The site's preview: the same route, which writes nothing. Its refusals
	// (merge_same_record, merge_formats_different_events) are the site's.
	request := func(dryRun bool) (mergeResult, error) {
		var result mergeResult
		err := t.inner.send(ctx, http.MethodPost, kind.route, map[string]any{"keepId": keepID, "mergeId": mergeID, "dryRun": dryRun}, &result)
		return result, err
	}
	preview, err := request(true)
	if err != nil {
		return fail(err)
	}

	// Always asked: what is merged is gone, and a merge is not undone. What the
	// preview says is shown, and is part of the state.
	counts := describeMerge(preview)
	said := strings.Join(counts, ", ")
	if len(counts) == 0 {
		said = lowerFirst(strings.TrimSuffix(kind.nothing, "."))
	}
	lines := []string{"Reste : " + keep.described + ".", "Fusionnée dans l'autre, puis supprimée : " + merged.described + "."}
	if len(counts) == 0 {
		lines = append(lines, kind.nothing)
	}
	for _, count := range counts {
		lines = append(lines, count+".")
	}
	previewed, err := json.Marshal(preview)
	if err != nil {
		return fail(err)
	}
	r := &risk{
		Message: fmt.Sprintf("Fusionner %s dans %s : ce qu'elle a passe sur l'autre, puis elle est supprimée. Selon l'aperçu du site : %s. La fusion est définitive.",
			merged.described, keep.described, said),
		Details: lines,
		Records: []stamp{
			{Collection: in.Kind, ID: keep.id, Updated: keep.updated},
			{Collection: in.Kind, ID: merged.id, Updated: merged.updated},
			{Collection: "merge-preview", ID: keep.id + "+" + merged.id, Updated: string(previewed)},
		},
	}
	proceed, out, notice, err := t.guard(ctx, "admin_merge", struct{ Kind, Keep, Merge string }{in.Kind, keepID, mergeID}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, mergeOut{writeStatus: notDoneOut(out, notice)}, nil
	}

	result, err := request(false)
	if err != nil {
		return fail(err)
	}
	done := describeMerge(result)
	summary := fmt.Sprintf("Fusion faite : %s reste, %s est supprimée.", quote(keep.name), quote(merged.name))
	if len(done) > 0 {
		summary += " " + upperFirst(strings.Join(done, ", ")) + "."
	}
	return nil, mergeOut{
		writeStatus: writeStatus{Done: true, Summary: summary},
		Result:      &result,
		Kept:        &mergedRef{ID: keep.id, Name: keep.name},
	}, nil
}
