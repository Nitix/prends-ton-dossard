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

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// This file has the race types of the admin (spec § 6.11): admin_create_race_type,
// admin_update_race_type and admin_delete_race_type, the page Types of the site
// (« Ajouter », « Renommer », « Mesures », « Supprimer »). The rules of the
// collection keep them to the admins, its index keeps the names unique without
// regard to the case, and its hook keeps a type that a format uses.

// storedRaceType is a race type with the moment it was last changed: the state of
// a confirmation.
type storedRaceType struct {
	raceTypeRecord
	Updated string `json:"updated"`
}

// storedRaceTypes are the race types, by name.
func (t *tools) storedRaceTypes(ctx context.Context) ([]storedRaceType, error) {
	return listAll[storedRaceType](ctx, t.inner, "race_types", url.Values{"sort": {"label"}}, 500)
}

// raceTypeNamed is the race type that an admin tool is given, by its id or its
// name.
func raceTypeNamed(all []storedRaceType, input string) (storedRaceType, error) {
	if strings.TrimSpace(input) == "" {
		return storedRaceType{}, errors.New("Il manque le type de course (race_type) : son nom ou son identifiant (list_race_types les donne).")
	}
	records := make([]raceTypeRecord, len(all))
	for i, r := range all {
		records[i] = r.raceTypeRecord
	}
	found, err := resolveRaceType(records, input)
	if err != nil {
		return storedRaceType{}, err
	}
	for _, r := range all {
		if r.ID == found.ID {
			return r, nil
		}
	}
	return storedRaceType{}, errors.New("mcp: a race type that is not among the race types")
}

// measuresIn are measures that a tool is given, each once, in the order of the
// form; the refusal of one that is not a measure.
func measuresIn(given []string) ([]string, error) {
	for _, m := range given {
		if !slices.Contains(allMeasures, m) {
			return nil, fmt.Errorf("measures : « %s » n'est pas une mesure (distance, elevation, duration ou time_limit).", m)
		}
	}
	out := []string{}
	for _, m := range allMeasures {
		if slices.Contains(given, m) {
			out = append(out, m)
		}
	}
	return out, nil
}

// raceTypeOutOf is a race type in an answer, as list_race_types gives it.
func raceTypeOutOf(r raceTypeRecord) raceTypeOut {
	return raceTypeOut{ID: r.ID, Label: r.Label, Measures: measuresOf(r)}
}

// raceTypeWritten is what admin_create_race_type and admin_update_race_type answer.
type raceTypeWritten struct {
	Done     bool        `json:"done" jsonschema:"toujours vrai : ce que le site refuse est une erreur"`
	RaceType raceTypeOut `json:"race_type" jsonschema:"le type, comme list_race_types le donne"`
	Summary  string      `json:"summary" jsonschema:"ce qui a été fait, en une phrase"`
}

// ---------------------------------------------------------------------------
// admin_create_race_type

type createRaceTypeIn struct {
	Label    string   `json:"label" jsonschema:"le nom du type (« Trail », « Route »), unique sans tenir compte de la casse : le site retire les espaces de début et de fin"`
	Measures []string `json:"measures,omitempty" jsonschema:"les mesures que le formulaire d'une épreuve de ce type montre d'abord : distance, elevation, duration, time_limit ; sans elles, les quatre"`
}

func addAdminCreateRaceType(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_create_race_type",
		Title: "Ajouter un type de course",
		Description: "Types → « Ajouter » : un type de course que toute épreuve peut prendre. " +
			"Le nom reste unique sans tenir compte de la casse : le site refuse un nom pris, avec son message. " +
			"measures dit ce que le formulaire d'une épreuve de ce type montre d'abord (distance, elevation, duration, time_limit) ; sans elles, les quatre.",
		InputSchema: inputSchema[createRaceTypeIn](map[string][]string{"measures": allMeasures}),
		Annotations: writeAnnotations(false, false),
	}, t.adminCreateRaceType)
}

func (t *tools) adminCreateRaceType(ctx context.Context, _ *mcpsdk.CallToolRequest, in createRaceTypeIn) (*mcpsdk.CallToolResult, raceTypeWritten, error) {
	if err := requireAdmin(ctx, "admin_create_race_type"); err != nil {
		return nil, raceTypeWritten{}, err
	}
	measures, err := measuresIn(in.Measures)
	if err != nil {
		return nil, raceTypeWritten{}, err
	}
	// The name as the form sends it: without the blanks around it. The site decides
	// what is blank and what is taken.
	var created raceTypeRecord
	body := map[string]any{"label": strings.TrimSpace(in.Label), "measures": measures}
	if err := t.inner.send(ctx, http.MethodPost, "/api/collections/race_types/records", body, &created); err != nil {
		return nil, raceTypeWritten{}, describe(t.app, err, nil)
	}
	out := raceTypeOutOf(created)
	return nil, raceTypeWritten{
		Done:     true,
		RaceType: out,
		Summary:  fmt.Sprintf("Le type de course %s est ajouté : une épreuve peut le prendre, et son formulaire montre d'abord %s.", quote(out.Label), strings.Join(out.Measures, ", ")),
	}, nil
}

// ---------------------------------------------------------------------------
// admin_update_race_type

type updateRaceTypeIn struct {
	RaceType string    `json:"race_type" jsonschema:"l'identifiant ou le nom du type (list_race_types les donne)"`
	Label    *string   `json:"label,omitempty" jsonschema:"le nouveau nom, unique sans tenir compte de la casse : toutes les épreuves de ce type l'affichent"`
	Measures *[]string `json:"measures,omitempty" jsonschema:"les mesures que le formulaire d'une épreuve de ce type montre d'abord : au moins une de distance, elevation, duration, time_limit"`
}

func addAdminUpdateRaceType(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_update_race_type",
		Title: "Modifier un type de course",
		Description: "Types → « Renommer », « Mesures » : le nom d'un type (label), ce que le formulaire d'une épreuve de ce type montre d'abord (measures), ou les deux. " +
			"Un nouveau nom change ce que toutes les courses affichent pour leurs épreuves de ce type. " +
			"Le nom reste unique sans tenir compte de la casse : le site refuse un nom pris. Ce qui ne change pas n'est pas écrit.",
		InputSchema: inputSchema[updateRaceTypeIn](map[string][]string{"measures": allMeasures}),
		Annotations: writeAnnotations(false, true),
	}, t.adminUpdateRaceType)
}

func (t *tools) adminUpdateRaceType(ctx context.Context, _ *mcpsdk.CallToolRequest, in updateRaceTypeIn) (*mcpsdk.CallToolResult, raceTypeWritten, error) {
	if err := requireAdmin(ctx, "admin_update_race_type"); err != nil {
		return nil, raceTypeWritten{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, raceTypeWritten, error) {
		return nil, raceTypeWritten{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, raceTypeWritten, error) {
		return nil, raceTypeWritten{}, err
	}
	all, err := t.storedRaceTypes(ctx)
	if err != nil {
		return fail(err)
	}
	raceType, err := raceTypeNamed(all, in.RaceType)
	if err != nil {
		return refuse(err)
	}
	if !isID(raceType.ID) {
		return fail(errors.New("mcp: a race type id that is not an id"))
	}
	if in.Label == nil && in.Measures == nil {
		return refuse(errors.New("Rien à modifier : donne label, measures, ou les deux."))
	}

	// Only what changes is sent: the name without the blanks around it, as the form
	// sends it; the measures in its order, at least one, as its dialog asks.
	body := map[string]any{}
	if in.Label != nil {
		if label := strings.TrimSpace(*in.Label); label != raceType.Label {
			body["label"] = label
		}
	}
	if in.Measures != nil {
		measures, err := measuresIn(*in.Measures)
		if err != nil {
			return refuse(err)
		}
		if len(measures) == 0 {
			return refuse(errors.New("measures : garde au moins une mesure (distance, elevation, duration ou time_limit)."))
		}
		if !slices.Equal(measures, measuresOf(raceType.raceTypeRecord)) {
			body["measures"] = measures
		}
	}
	if len(body) == 0 {
		return nil, raceTypeWritten{
			Done:     true,
			RaceType: raceTypeOutOf(raceType.raceTypeRecord),
			Summary:  fmt.Sprintf("Rien à changer : le type de course %s est déjà ainsi.", quote(raceType.Label)),
		}, nil
	}
	var updated raceTypeRecord
	if err := t.inner.send(ctx, http.MethodPatch, "/api/collections/race_types/records/"+raceType.ID, body, &updated); err != nil {
		return fail(err)
	}

	out := raceTypeOutOf(updated)
	var said []string
	if _, renamed := body["label"]; renamed {
		said = append(said, fmt.Sprintf("Le type %s s'appelle maintenant %s : toutes les épreuves de ce type l'affichent sous ce nom.", quote(raceType.Label), quote(out.Label)))
	}
	if _, changed := body["measures"]; changed {
		said = append(said, fmt.Sprintf("Le formulaire d'une épreuve de type %s montre d'abord %s.", quote(out.Label), strings.Join(out.Measures, ", ")))
	}
	return nil, raceTypeWritten{Done: true, RaceType: out, Summary: strings.Join(said, " ")}, nil
}

// ---------------------------------------------------------------------------
// admin_delete_race_type

type deleteRaceTypeIn struct {
	RaceType     string `json:"race_type" jsonschema:"l'identifiant ou le nom du type (list_race_types les donne)"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in deleteRaceTypeIn) confirmationGiven() string { return in.Confirmation }

type deleteRaceTypeOut struct {
	writeStatus
	Removed *raceTypeRef `json:"removed,omitempty" jsonschema:"le type supprimé"`
}

var deleteRaceTypeSchema = sync.OnceValue(writeSchema[deleteRaceTypeOut])

func addAdminDeleteRaceType(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_delete_race_type",
		Title: "Supprimer un type de course",
		Description: "Types → « Supprimer » : un type qu'aucune épreuve n'a. " +
			"Le site refuse de supprimer un type qu'une épreuve utilise (race_type_in_use) : l'outil l'annonce sans rien demander, avec le nombre d'épreuves. " +
			"Sinon, il demande toujours une confirmation : le premier appel ne fait rien, et donne un jeton à redonner si la personne accepte.",
		InputSchema:  inputSchema[deleteRaceTypeIn](nil),
		OutputSchema: deleteRaceTypeSchema(),
		Annotations:  writeAnnotations(true, false),
	}, adminWrite(t, "admin_delete_race_type", t.adminDeleteRaceType))
}

func (t *tools) adminDeleteRaceType(ctx context.Context, _ *mcpsdk.CallToolRequest, in deleteRaceTypeIn) (*mcpsdk.CallToolResult, deleteRaceTypeOut, error) {
	if err := requireAdmin(ctx, "admin_delete_race_type"); err != nil {
		return nil, deleteRaceTypeOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, deleteRaceTypeOut, error) {
		return nil, deleteRaceTypeOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, deleteRaceTypeOut, error) {
		return nil, deleteRaceTypeOut{}, err
	}
	all, err := t.storedRaceTypes(ctx)
	if err != nil {
		return fail(err)
	}
	raceType, err := raceTypeNamed(all, in.RaceType)
	if err != nil {
		return refuse(err)
	}
	if !isID(raceType.ID) {
		return fail(errors.New("mcp: a race type id that is not an id"))
	}
	// The refusal of the site (the hook of the race types): a type in use stays.
	n, err := t.countWhere(ctx, "formats", "race_type", raceType.ID)
	if err != nil {
		return fail(err)
	}
	switch {
	case n == 1:
		return refuse(fmt.Errorf("1 épreuve est de type %s : change son type ou fusionne-la d'abord. (race_type_in_use)", quote(raceType.Label)))
	case n > 1:
		return refuse(fmt.Errorf("%d épreuves sont de type %s : change leur type ou fusionne-les d'abord. (race_type_in_use)", n, quote(raceType.Label)))
	}

	// Always asked: the type is no longer offered for a format.
	line := fmt.Sprintf("Le type de course %s (mesures : %s) sera supprimé : il ne sera plus proposé pour une épreuve.",
		quote(raceType.Label), strings.Join(measuresOf(raceType.raceTypeRecord), ", "))
	r := &risk{Message: line, Details: []string{line}, Records: []stamp{{Collection: "race_types", ID: raceType.ID, Updated: raceType.Updated}}}
	proceed, out, notice, err := t.guard(ctx, "admin_delete_race_type", struct{ RaceType string }{raceType.ID}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, deleteRaceTypeOut{writeStatus: notDoneOut(out, notice)}, nil
	}
	if err := t.inner.send(ctx, http.MethodDelete, "/api/collections/race_types/records/"+raceType.ID, nil, nil); err != nil {
		return fail(err)
	}
	return nil, deleteRaceTypeOut{
		writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("Le type de course %s est supprimé.", quote(raceType.Label))},
		Removed:     &raceTypeRef{ID: raceType.ID, Label: raceType.Label},
	}, nil
}
