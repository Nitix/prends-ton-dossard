package mcp_test

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The cases of significantWords in duplicates.test.ts.
func TestSignificantWords(t *testing.T) {
	for _, row := range []struct {
		name, input string
		want        []string
	}{
		{"the words of four letters or more, in lowercase, with no figure", "Trail des Crêtes 2026", []string{"trail", "crêtes"}},
		{"a word that comes twice is kept once", "Trail du TRAIL trail", []string{"trail"}},
		// "Crêtes" in its decomposed form: an e, then the circumflex.
		{"an accent is a letter, composed or not", "Crêtes", []string{"crêtes"}},
		{"a name made of short words has none", "Le 10 km", nil},
		{"an empty name has none", "", nil},
		{"an apostrophe or a hyphen separates words", "Foulées d'automne-hiver", []string{"foulées", "automne", "hiver"}},
		{"the accents are kept, in upper case too", "ÉCOLE DES NEIGES", []string{"école", "neiges"}},
		// The words go into no filter: a quote changes nothing.
		{"a quote is no letter", `Trail" || 1=1 || "x`, []string{"trail"}},
	} {
		if got := mcp.SignificantWords(row.input); !slices.Equal(got, row.want) {
			t.Errorf("%s: significantWords(%q) = %q, want %q", row.name, row.input, got, row.want)
		}
	}
}

// The likely duplicates of a race: the events that start within 30 days of its
// first day, asked for by days, whose name holds a word of four letters of its
// own, matched here.
func TestDuplicates(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	event := func(name, start string) *core.Record {
		return create(t, app, "events", map[string]any{"name": name, "location": "Annecy", "start_date": start, "created_by": fx.AliceRunner.Id})
	}
	// Around 2026-07-13: 30 days before is 2026-06-13, 30 days after 2026-08-12.
	event("Trail du lac", "2026-06-12")               // 31 days before
	first := event("TRAIL des Lacs", "2026-06-13")    // 30 days before, in upper case
	last := event("Ultra-trail du Lac", "2026-08-12") // 30 days after
	event("Trail d'été", "2026-08-13")                // 31 days after
	other := event("Course des Lacs", "2026-07-13")   // "lacs" is a word of the name
	event("Foulées de Noël", "2026-07-13")            // no word of the name

	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		find := func(name, start, exceptID string) []string {
			t.Helper()
			ids, err := mcp.Duplicates(as(fx.Alice), app, inner, name, start, exceptID)
			if err != nil {
				t.Fatalf("duplicates of %q: %v", name, err)
			}
			slices.Sort(ids)
			return ids
		}
		want := func(records ...*core.Record) []string {
			var ids []string
			for _, r := range records {
				ids = append(ids, r.Id)
			}
			slices.Sort(ids)
			return ids
		}

		// The Trail des Crêtes (2026-06-13) and the 10 km de Lyon (2026-06-22)
		// of the fixture are within 30 days of 2026-07-13 too: "trail" finds the
		// first, and nothing finds the second.
		if got, w := find("Trail des Lacs", "2026-07-13", ""), want(first, last, other, fx.Event); !slices.Equal(got, w) {
			t.Errorf("the duplicates of « Trail des Lacs » are %q, want %q", got, w)
		}

		// The edited event is no duplicate of itself.
		if got, w := find("Trail des Lacs", "2026-07-13", first.Id), want(last, other, fx.Event); !slices.Equal(got, w) {
			t.Errorf("without the edited event: %q, want %q", got, w)
		}

		// A name with no word of four letters asks nothing.
		counted := mcp.CountInnerRequests(t)
		if got := find("Le 10 km", "2026-07-13", ""); len(got) != 0 {
			t.Errorf("« Le 10 km » has duplicates %q, want none", got)
		}
		if counted.Total() != 0 {
			t.Errorf("a name with no word sent %d requests, want none", counted.Total())
		}

		// The name is matched here, in lower case: it goes into no filter.
		if got := find(`Lacs" || 1=1 || "x`, "2026-07-13", ""); !slices.Equal(got, want(first, other)) {
			t.Errorf("a name with a quote: %q, want the events whose name holds « lacs »", got)
		}
		if counted.Of(http.MethodGet) == 0 {
			t.Error("the search sent no request")
		}
	})
}
