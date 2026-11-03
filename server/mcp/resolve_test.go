package mcp_test

import (
	"fmt"
	"strings"
	"testing"

	"courses/server/mcp"
)

// A runner and a race type are given by their id or by their name, whatever the
// case and the accents (spec § 6.1).
func TestResolve(t *testing.T) {
	const (
		aliceID  = "aaaaaaaaaaaaaaa"
		bobID    = "bbbbbbbbbbbbbbb"
		elodieID = "eeeeeeeeeeeeeee"
		jeanID   = "jjjjjjjjjjjjjjj"
	)
	runners := []mcp.RunnerRecord{
		{ID: aliceID, Name: "Alice", User: "u1"},
		{ID: bobID, Name: "Bob"},
		{ID: elodieID, Name: "Élodie"},
		{ID: jeanID, Name: "Jean-Pierre"},
	}

	t.Run("runners", func(t *testing.T) {
		for _, row := range []struct {
			name, input, me string
			want            string
		}{
			{"by id", bobID, aliceID, bobID},
			{"by name", "Bob", aliceID, bobID},
			{"by name in another case", "bOB", aliceID, bobID},
			{"with the blanks around", "  Bob ", aliceID, bobID},
			{"the accents of the name are folded", "elodie", aliceID, elodieID},
			{"and the ones of the input", "ÉLODIE", aliceID, elodieID},
			{"a hyphen is a space", "jean pierre", aliceID, jeanID},
			{"and a space is a hyphen", "Jean-Pierre", aliceID, jeanID},
			{"no input is the runner of the caller", "", aliceID, aliceID},
			{"blanks are no input", "   ", bobID, bobID},
		} {
			t.Run(row.name, func(t *testing.T) {
				got, err := mcp.ResolveRunner(runners, row.input, row.me)
				if err != nil {
					t.Fatal(err)
				}
				if got.ID != row.want {
					t.Errorf("resolved %s (%s), want %s", got.ID, got.Name, row.want)
				}
			})
		}

		for _, row := range []struct {
			name, input, me, want string
		}{
			{
				"an unknown name lists the names", "Zoé", aliceID,
				"Coureur inconnu : « Zoé ». Les coureurs du groupe : Alice, Bob, Élodie, Jean-Pierre.",
			},
			{
				"a part of a name is no name", "Ali", aliceID,
				"Coureur inconnu : « Ali ». Les coureurs du groupe : Alice, Bob, Élodie, Jean-Pierre.",
			},
			{
				"an id that nobody has", "zzzzzzzzzzzzzzz", aliceID,
				"Coureur inconnu : « zzzzzzzzzzzzzzz ». Les coureurs du groupe : Alice, Bob, Élodie, Jean-Pierre.",
			},
			{"no input, and no runner for the caller", "", "", "Ton compte n'a pas de coureur : demande à un admin."},
			{"no input, and a runner who is not there", "", "zzzzzzzzzzzzzzz", "Ton compte n'a pas de coureur : demande à un admin."},
		} {
			t.Run(row.name, func(t *testing.T) {
				_, err := mcp.ResolveRunner(runners, row.input, row.me)
				if err == nil || err.Error() != row.want {
					t.Errorf("error %v, want %q", err, row.want)
				}
			})
		}

		t.Run("the names are listed in order, whatever the order they come in", func(t *testing.T) {
			_, err := mcp.ResolveRunner([]mcp.RunnerRecord{runners[3], runners[1], runners[2], runners[0]}, "Zoé", aliceID)
			want := "Coureur inconnu : « Zoé ». Les coureurs du groupe : Alice, Bob, Élodie, Jean-Pierre."
			if err == nil || err.Error() != want {
				t.Errorf("error %v, want %q", err, want)
			}
		})

		t.Run("two runners with the same name are not guessed", func(t *testing.T) {
			twins := append([]mcp.RunnerRecord{{ID: "ddddddddddddddd", Name: "alice"}}, runners...)
			_, err := mcp.ResolveRunner(twins, "ALICE", aliceID)
			want := "Plusieurs coureurs s'appellent « ALICE » : donne l'identifiant de celui que tu veux (ddddddddddddddd, aaaaaaaaaaaaaaa)."
			if err == nil || err.Error() != want {
				t.Errorf("error %v, want %q", err, want)
			}
			// Their ids still tell them apart.
			got, err := mcp.ResolveRunner(twins, aliceID, aliceID)
			if err != nil || got.ID != aliceID {
				t.Errorf("by id: %v, %v", got, err)
			}
		})

		t.Run("a long list of names is cut", func(t *testing.T) {
			var many []mcp.RunnerRecord
			var first15 []string
			for i := 1; i <= 20; i++ {
				name := fmt.Sprintf("Coureur %02d", i)
				many = append(many, mcp.RunnerRecord{ID: fmt.Sprintf("%015d", i), Name: name})
				if i <= 15 {
					first15 = append(first15, name)
				}
			}
			_, err := mcp.ResolveRunner(many, "Zoé", "")
			want := "Coureur inconnu : « Zoé ». Les coureurs du groupe : " + strings.Join(first15, ", ") + " et 5 autres (list_runners les donne tous)."
			if err == nil || err.Error() != want {
				t.Errorf("error %v, want %q", err, want)
			}
		})
	})

	t.Run("race types", func(t *testing.T) {
		trailID, creteID := "ttttttttttttttt", "ccccccccccccccc"
		types := []mcp.RaceTypeRecord{
			{ID: trailID, Label: "Trail"},
			{ID: "rrrrrrrrrrrrrrr", Label: "Route"},
			{ID: creteID, Label: "Crête"},
			{ID: "uuuuuuuuuuuuuuu", Label: "Ultra-trail"},
		}
		for _, row := range []struct{ name, input, want string }{
			{"by id", trailID, trailID},
			{"by name", "Trail", trailID},
			{"in another case", "trail", trailID},
			{"with the accents folded", "Crete", creteID},
			{"and the ones of the input", "CRÊTE", creteID},
			{"a hyphen is a space", "ultra trail", "uuuuuuuuuuuuuuu"},
		} {
			t.Run(row.name, func(t *testing.T) {
				got, err := mcp.ResolveRaceType(types, row.input)
				if err != nil {
					t.Fatal(err)
				}
				if got.ID != row.want {
					t.Errorf("resolved %s (%s), want %s", got.ID, got.Label, row.want)
				}
			})
		}

		_, err := mcp.ResolveRaceType(types, "Marche")
		want := "Type de course inconnu : « Marche ». Les types de course : Crête, Route, Trail, Ultra-trail."
		if err == nil || err.Error() != want {
			t.Errorf("an unknown type: error %v, want %q", err, want)
		}
		_, err = mcp.ResolveRaceType(types, "")
		if err == nil {
			t.Error("no name is no race type")
		}
	})
}
