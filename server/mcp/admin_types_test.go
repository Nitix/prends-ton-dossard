package mcp_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/mcp"
)

// The race types of the admin (spec § 6.11): Types → « Ajouter », « Renommer »,
// « Mesures », « Supprimer ».

func TestAdmin_RaceTypes(t *testing.T) {
	app, fx, admin := adminApp(t)

	// listed is the race type of that name that list_race_types gives, nil for none.
	listed := func(t *testing.T, label string) map[string]any {
		t.Helper()
		result := succeeded(t, callTool(t, app, admin, "list_race_types", nil))
		list, _ := result.Structured["race_types"].([]any)
		for _, item := range list {
			if raceType := item.(map[string]any); raceType["label"] == label {
				return raceType
			}
		}
		return nil
	}

	var rando string
	t.Run("a new type, with its measures in the order of the form", func(t *testing.T) {
		result := isDone(t, callTool(t, app, admin, "admin_create_race_type", map[string]any{"label": " Rando ", "measures": []any{"elevation", "distance", "elevation"}}))
		raceType, _ := result.Structured["race_type"].(map[string]any)
		rando, _ = raceType["id"].(string)
		want := map[string]any{"id": rando, "label": "Rando", "measures": []any{"distance", "elevation"}}
		assertJSON(t, raceType, want)
		assertJSON(t, listed(t, "Rando"), want)
	})

	t.Run("a type without measures has all four", func(t *testing.T) {
		result := isDone(t, callTool(t, app, admin, "admin_create_race_type", map[string]any{"label": "Course d'orientation"}))
		raceType, _ := result.Structured["race_type"].(map[string]any)
		assertJSON(t, raceType["measures"], []any{"distance", "elevation", "duration", "time_limit"})
	})

	t.Run("a name that is taken, whatever the case", func(t *testing.T) {
		refused(t, app, admin, "admin_create_race_type", map[string]any{"label": "rando"}, "nom du type : cette valeur est déjà utilisée. (validation_not_unique)")
	})

	t.Run("a new name: every race shows it", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, admin, "admin_update_race_type", map[string]any{"race_type": "trail", "label": "Trail nature"}))
		if got := counted.Of(http.MethodPatch); got != 1 {
			t.Errorf("%d PATCH, want one", got)
		}
		if summary := summaryOfResult(result); !strings.Contains(summary, "« Trail » s'appelle maintenant « Trail nature »") || !strings.Contains(summary, "toutes les épreuves de ce type") {
			t.Errorf("the summary is %q", summary)
		}
		event := succeeded(t, callTool(t, app, admin, "get_event", map[string]any{"event_id": fx.Event.Id}))
		for _, format := range formatsOf(t, event) {
			if label := format["race_type"].(map[string]any)["label"]; label != "Trail nature" {
				t.Errorf("the format %s shows the type %v", format["id"], label)
			}
		}
	})

	t.Run("the measures", func(t *testing.T) {
		isDone(t, callTool(t, app, admin, "admin_update_race_type", map[string]any{"race_type": rando, "measures": []any{"duration"}}))
		assertJSON(t, listed(t, "Rando")["measures"], []any{"duration"})
		announced(t, app, admin, "admin_update_race_type", map[string]any{"race_type": "Rando", "measures": []any{}}, "measures : garde au moins une mesure")
	})

	t.Run("nothing to change", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, admin, "admin_update_race_type", map[string]any{"race_type": "Rando", "label": "Rando", "measures": []any{"duration"}}))
			if summary := summaryOfResult(result); !strings.HasPrefix(summary, "Rien à changer") {
				t.Errorf("the summary is %q", summary)
			}
			// The measures of Route, in another order and one of them twice.
			result = isDone(t, callTool(t, app, admin, "admin_update_race_type", map[string]any{"race_type": "Route", "measures": []any{"time_limit", "elevation", "distance", "distance"}}))
			if summary := summaryOfResult(result); !strings.HasPrefix(summary, "Rien à changer") {
				t.Errorf("the summary is %q", summary)
			}
		})
		announced(t, app, admin, "admin_update_race_type", map[string]any{"race_type": "Rando"}, "Rien à modifier : donne label, measures, ou les deux.")
	})

	t.Run("a measure that is not one", func(t *testing.T) {
		// Through /mcp, the schema refuses it before the tool.
		writesNothing(t, app, func() {
			if result := callTool(t, app, admin, "admin_create_race_type", map[string]any{"label": "Marche", "measures": []any{"altitude"}}); !result.IsError {
				t.Errorf("a measure that is not one is answered %.200s", result.Text)
			}
		})
		// Called directly, the tool refuses it too.
		inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
			for _, name := range []string{"admin_create_race_type", "admin_update_race_type"} {
				err := mcp.CallAdminTool(as(fx.Admin), app, inner, name, map[string]any{"label": "Marche", "race_type": "Trail nature", "measures": []any{"distance", "altitude"}})
				if err == nil || err.Error() != "measures : « altitude » n'est pas une mesure (distance, elevation, duration ou time_limit)." {
					t.Errorf("%s with a measure that is not one: %v", name, err)
				}
			}
		})
	})

	t.Run("an unknown type", func(t *testing.T) {
		announced(t, app, admin, "admin_update_race_type", map[string]any{"race_type": "Marche", "label": "Marche nordique"}, "Type de course inconnu : « Marche ».")
	})

	t.Run("a type that no format uses is deleted, once the person agrees", func(t *testing.T) {
		var message string
		var details []string
		writesNothing(t, app, func() {
			_, message, details = asked(t, callTool(t, app, admin, "admin_delete_race_type", map[string]any{"race_type": "Rando"}))
		})
		mentions(t, message, details, "Le type de course « Rando » (mesures : duration) sera supprimé")
		result := confirmAndCall(t, app, admin, "admin_delete_race_type", map[string]any{"race_type": "Rando"})
		assertJSON(t, result.Structured["removed"], map[string]any{"id": rando, "label": "Rando"})
		if storedRecord(t, app, "race_types", rando) != nil {
			t.Error("Rando is still there")
		}
	})

	t.Run("a type in use: the site's refusal, announced with the number of formats", func(t *testing.T) {
		announced(t, app, admin, "admin_delete_race_type", map[string]any{"race_type": "Trail nature"},
			"2 épreuves sont de type « Trail nature » : change leur type ou fusionne-les d'abord. (race_type_in_use)")
		announced(t, app, admin, "admin_delete_race_type", map[string]any{"race_type": "Route"},
			"1 épreuve est de type « Route » : change son type ou fusionne-la d'abord. (race_type_in_use)")
	})
}
