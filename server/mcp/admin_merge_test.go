package mcp_test

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"courses/server/mcp"
)

// The duplicates of the admin (spec § 6.11): two races, or two formats of one race,
// merged by the site's own route, after its preview.

// The French cases of web/src/features/admin/mergePreview.test.ts, for the port of
// describeMerge.
func TestDescribeMerge(t *testing.T) {
	for _, row := range []struct {
		name   string
		result mcp.MergeResult
		want   []string
	}{
		{"a counter of one is singular, in French", mcp.MergeResult{MovedFormats: 1}, []string{"1 épreuve déplacée"}},
		{"a counter of two is plural, in French", mcp.MergeResult{MovedFormats: 2}, []string{"2 épreuves déplacées"}},
		{"a duplicate participation that is removed", mcp.MergeResult{DroppedParticipations: 1}, []string{"1 participation en double supprimée"}},
		{"duplicate participations that are removed", mcp.MergeResult{DroppedParticipations: 3}, []string{"3 participations en double supprimées"}},
		{"a counter that is zero has no line", mcp.MergeResult{}, nil},
		{
			"one line per counter that is not zero, in the order of the merge",
			mcp.MergeResult{MovedFormats: 2, MovedParticipations: 5, DroppedParticipations: 1, ClearedFormatDates: 1, MovedComments: 4, MovedOffers: 2},
			[]string{
				"2 épreuves déplacées",
				"5 participations déplacées",
				"1 participation en double supprimée",
				"1 date d'épreuve effacée (hors des dates de l'événement)",
				"4 commentaires déplacés",
				"2 offres déplacées",
			},
		},
		{"describeMerge — commentaires déplacés (1)", mcp.MergeResult{MovedComments: 1}, []string{"1 commentaire déplacé"}},
		{"describeMerge — commentaires déplacés (3)", mcp.MergeResult{MovedComments: 3}, []string{"3 commentaires déplacés"}},
		{"describeMerge — offres déplacées (1)", mcp.MergeResult{MovedOffers: 1}, []string{"1 offre déplacée"}},
		{"describeMerge — offres déplacées (3)", mcp.MergeResult{MovedOffers: 3}, []string{"3 offres déplacées"}},
		{
			"both counters of a merge of formats: two moved and one dropped",
			mcp.MergeResult{MovedParticipations: 2, DroppedParticipations: 1},
			[]string{"2 participations déplacées", "1 participation en double supprimée"},
		},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := mcp.DescribeMerge(row.result); !slices.Equal(got, row.want) {
				t.Errorf("describeMerge = %q, want %q", got, row.want)
			}
		})
	}
}

func TestAdmin_Merge(t *testing.T) {
	app, fx, admin := adminApp(t)

	// Two copies of one race: the one to keep, with Alice on its marathon; the
	// other, with Bob on its own marathon, Sam who has not chosen, a comment and a
	// ride.
	keep := create(t, app, "events", map[string]any{"name": "Marathon d'Annecy", "location": "Annecy", "start_date": "2026-09-20", "created_by": fx.AliceRunner.Id})
	keepFormat := create(t, app, "formats", map[string]any{"event": keep.Id, "race_type": fx.Road.Id, "distance_km": 42.195})
	joined(t, app, fx.AliceRunner, keepFormat, "registered", true, fx.AliceRunner)
	other := create(t, app, "events", map[string]any{"name": "Marathon Annecy", "location": "Annecy", "start_date": "2026-09-20", "created_by": fx.BobRunner.Id})
	otherFormat := create(t, app, "formats", map[string]any{"event": other.Id, "race_type": fx.Road.Id, "distance_km": 42.195})
	joined(t, app, fx.BobRunner, otherFormat, "interested", true, fx.BobRunner)
	joinedEvent(t, app, fx.SamRunner, other, "interested", false, fx.BobRunner)
	commentOn(t, app, other, fx.BobRunner, "Qui vient ?")
	rideOf(t, app, other, fx.BobRunner)
	args := map[string]any{"kind": "events", "keep_id": keep.Id, "merge_id": other.Id}

	// The first call is the site's preview, which merges nothing.
	before := dbState(t, app)
	counted := mcp.CountInnerRequests(t)
	token, message, details := asked(t, callTool(t, app, admin, "admin_merge", args))
	mentions(t, message, details,
		"Reste : la course « Marathon d'Annecy » (2026-09-20, Annecy)",
		"Fusionnée dans l'autre, puis supprimée : la course « Marathon Annecy » (2026-09-20, Annecy)",
		"1 épreuve déplacée", "2 participations déplacées", "1 commentaire déplacé", "1 offre déplacée",
		"La fusion est définitive.")
	if got := counted.Of(http.MethodPost); got != 1 || counted.Total()-counted.Of(http.MethodGet) != 1 {
		t.Errorf("%d POST and %d other writes, want the one of the preview", got, counted.Total()-counted.Of(http.MethodGet)-got)
	}
	if after := dbState(t, app); after != before {
		t.Fatalf("the preview changed the database:\nbefore\n%s\nafter\n%s", before, after)
	}

	// Meanwhile, Alice is added to the other marathon: the preview is not the one
	// that the person agreed to any more.
	joined(t, app, fx.AliceRunner, otherFormat, "interested", false, fx.BobRunner)
	again := callTool(t, app, admin, "admin_merge", with(args, token))
	fresh, message, details := asked(t, again)
	const changed = "Confirmation refusée : la situation a changé depuis. Nouveau : « 3 participations déplacées ». Plus d'actualité : « 2 participations déplacées »."
	if summary := summaryOfResult(again); !strings.HasPrefix(summary, changed) {
		t.Errorf("the summary is %q, want it to start with %q", summary, changed)
	}
	mentions(t, message, details, "3 participations déplacées")
	if storedRecord(t, app, "events", other.Id) == nil {
		t.Fatal("the other race is gone before the person agreed")
	}

	// With the fresh token: merged, and the result is the route's.
	done := isDone(t, callTool(t, app, admin, "admin_merge", with(args, fresh)))
	assertJSON(t, done.Structured["result"], map[string]any{
		"movedFormats": 1, "movedParticipations": 3, "droppedParticipations": 0, "clearedFormatDates": 0, "movedComments": 1, "movedOffers": 1,
	})
	assertJSON(t, done.Structured["kept"], map[string]any{"id": keep.Id, "name": "Marathon d'Annecy"})
	if storedRecord(t, app, "events", other.Id) != nil {
		t.Error("the other race is still there")
	}
	if moved := storedRecord(t, app, "formats", otherFormat.Id); moved == nil || moved.GetString("event") != keep.Id {
		t.Error("the other marathon is not on the race that is kept")
	}

	t.Run("two formats of a race", func(t *testing.T) {
		args := map[string]any{"kind": "formats", "keep_id": fx.F42.Id, "merge_id": fx.F15.Id}
		_, message, details := asked(t, callTool(t, app, admin, "admin_merge", args))
		mentions(t, message, details,
			"Reste : l'épreuve « Trail 42 km » (Trail des Crêtes)",
			"Fusionnée dans l'autre, puis supprimée : l'épreuve « Trail 15 km » (Trail des Crêtes)",
			"1 participation déplacée")
		done := confirmAndCall(t, app, admin, "admin_merge", args)
		assertJSON(t, done.Structured["kept"], map[string]any{"id": fx.F42.Id, "name": "Trail 42 km"})
		if storedRecord(t, app, "formats", fx.F15.Id) != nil {
			t.Error("F15 is still there")
		}
		if p := storedRecord(t, app, "participations", fx.P3.Id); p == nil || p.GetString("format") != fx.F42.Id {
			t.Error("Sam is not on F42")
		}
	})

	t.Run("the same race twice: the preview's refusal", func(t *testing.T) {
		refused(t, app, admin, "admin_merge", map[string]any{"kind": "events", "keep_id": fx.Event.Id, "merge_id": fx.Event.Id},
			"Choisis deux éléments différents. (merge_same_record)")
	})

	t.Run("formats of two races: the preview's refusal", func(t *testing.T) {
		refused(t, app, admin, "admin_merge", map[string]any{"kind": "formats", "keep_id": fx.F42.Id, "merge_id": fx.FLyon.Id},
			"Ces deux épreuves ne sont pas du même événement. (merge_formats_different_events)")
	})

	t.Run("ids that are not ones, or of nothing", func(t *testing.T) {
		announced(t, app, admin, "admin_merge", map[string]any{"kind": "events", "keep_id": "Trail des Crêtes", "merge_id": fx.Event2.Id},
			"« Trail des Crêtes » n'est pas un identifiant de course : search_events donne ceux des courses.")
		announced(t, app, admin, "admin_merge", map[string]any{"kind": "formats", "keep_id": fx.F42.Id, "merge_id": other.Id},
			"merge_id : aucune épreuve n'a l'identifiant « "+other.Id+" »")
	})
}
