package mcp_test

import (
	"strings"
	"testing"

	"courses/server/mcp"
)

func TestParseFinishTime(t *testing.T) {
	for _, row := range []struct {
		in   string
		want int
		// ok is false for a time that is refused.
		ok bool
	}{
		{"4:12:30", 4*3600 + 12*60 + 30, true},
		{"0:45:00", 45 * 60, true},
		{"45:00", 45 * 60, true},
		{"5:30", 5*60 + 30, true},
		{"04:12:30", 4*3600 + 12*60 + 30, true},
		{" 4:12:30 ", 4*3600 + 12*60 + 30, true},
		{"100:00:00", 100 * 3600, true},
		{"0:00:01", 1, true},
		{"4:60:00", 0, false},
		{"4:12:60", 0, false},
		{"60:00", 0, false},
		{"45:61", 0, false},
		{"abc", 0, false},
		{"", 0, false},
		{"   ", 0, false},
		{"0:00:00", 0, false},
		{"0:00", 0, false},
		{"4", 0, false},
		{"4:5:30", 0, false},
		{"4:12:3", 0, false},
		{"4:12:30:5", 0, false},
		{"-1:00:00", 0, false},
		{"+4:12:30", 0, false},
		{"4:12:30.5", 0, false},
		{"4h12m30s", 0, false},
		{"٤:12:30", 0, false},
		{"10000:00:00", 0, false},
	} {
		got, err := mcp.ParseFinishTime(row.in)
		switch {
		case row.ok && err != nil:
			t.Errorf("%q: refused (%v), want %d", row.in, err, row.want)
		case row.ok && got != row.want:
			t.Errorf("%q: %d s, want %d", row.in, got, row.want)
		case !row.ok && err == nil:
			t.Errorf("%q: read as %d s, want it refused", row.in, got)
		case !row.ok && !strings.Contains(err.Error(), "h:mm:ss"):
			t.Errorf("%q: the refusal is %q, want it to give the form of a time", row.in, err)
		}
	}
}

// A result is written whole, with the site's rules: at once when it replaces
// nothing a person entered and is the caller's own; asked first otherwise.
func TestTools_SetResult(t *testing.T) {
	t.Run("her own, past race: written at once, said as the site says it", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		args := map[string]any{
			"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4:12:30", "rank": 12, "rank_of": 340, "note": " 3e V1H ",
		}

		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, alice, "set_result", args))
		if got := counted.Of("PATCH"); got != 1 {
			t.Errorf("%d PATCH, want one", got)
		}
		if got := counted.Total() - counted.Of("GET") - counted.Of("PATCH"); got != 0 {
			t.Errorf("%d other requests that are not reads, want none", got)
		}
		if want := "Terminé · 4h 12min 30s · 12e sur 340 · 3e V1H"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
		p := participationIn(t, result, "participation")
		assertJSON(t, p["result"], map[string]any{"finish_time": "4:12:30", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "note": "3e V1H"})
		if p["status"] != "finished" || p["confirmed"] != true {
			t.Errorf("the participation is %v", p)
		}
		assertJSON(t, result.Structured["event"], map[string]any{"id": fx.Event.Id, "name": "Trail des Crêtes", "url": siteURL + "/evenements/" + fx.Event.Id})
		if result.Structured["format_title"] != "Trail 42 km" {
			t.Errorf("format_title = %v", result.Structured["format_title"])
		}
		stored := storedRecord(t, app, "participations", fx.P1.Id)
		if stored.GetString("status") != "finished" || stored.GetInt("finish_time_s") != 15150 || stored.GetInt("rank") != 12 ||
			stored.GetInt("rank_of") != 340 || stored.GetString("result_note") != "3e V1H" {
			t.Errorf("the stored result is %s %d s %d of %d %q", stored.GetString("status"), stored.GetInt("finish_time_s"), stored.GetInt("rank"), stored.GetInt("rank_of"), stored.GetString("result_note"))
		}

		// Another time: the result of the person is replaced, so the person is asked.
		again := map[string]any{
			"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4:10:00", "rank": 12, "rank_of": 340, "note": "3e V1H",
		}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "set_result", again))
			mentions(t, message, details, "4h 12min 30s", "4h 10min", "12e sur 340")
			if strings.Contains(message+strings.Join(details, "\n"), "d'un autre coureur") {
				t.Error("the confirmation says that her own participation is somebody else's")
			}
		})
		if got := storedRecord(t, app, "participations", fx.P1.Id).GetInt("finish_time_s"); got != 15150 {
			t.Fatalf("the time is %d s before the confirmation, want 15150", got)
		}
		confirmAndCall(t, app, alice, "set_result", again)
		if got := storedRecord(t, app, "participations", fx.P1.Id).GetInt("finish_time_s"); got != 15000 {
			t.Errorf("the time is %d s, want 15000", got)
		}

		// The same result again: nothing to write, nothing to ask.
		writesNothing(t, app, func() {
			same := isDone(t, callTool(t, app, alice, "set_result", again))
			if !strings.Contains(summaryOfResult(same), "Rien à changer") {
				t.Errorf("the summary is %q", summaryOfResult(same))
			}
		})
	})

	t.Run("a result that only fills what is empty asks nothing", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150})
		result := isDone(t, callTool(t, app, alice, "set_result", map[string]any{
			"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4:12:30", "rank": 12,
		}))
		if want := "Terminé · 4h 12min 30s · 12e"; !strings.Contains(summaryOfResult(result), want) || strings.Contains(summaryOfResult(result), " sur ") {
			t.Errorf("the summary is %q, want %q alone", summaryOfResult(result), want)
		}
		if stored := storedRecord(t, app, "participations", fx.P1.Id); stored.GetInt("rank") != 12 || stored.GetInt("rank_of") != 0 {
			t.Errorf("the stored rank is %d of %d", stored.GetInt("rank"), stored.GetInt("rank_of"))
		}
	})

	// The result is written whole, as the form of the site does: what the call does
	// not give is cleared. A confirmation is asked first, and once it is given the
	// database holds exactly the new result: a rank, a number ranked or a note that
	// was left out is gone, and the time, which the call gives, stays.
	t.Run("a rank, a number ranked or a note that was entered: changing or dropping any is asked, and the result is then written whole", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		same := map[string]any{"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4:12:30", "rank": 12, "rank_of": 340, "note": "3e V1H"}

		for _, row := range []struct {
			name string
			// change is what the call gives otherwise, and drop what it leaves out.
			change map[string]any
			drop   []string
			want   []string
			// stored is the result that the database holds once it is written.
			rank, rankOf int
			note         string
		}{
			{"another rank", map[string]any{"rank": 11}, nil, []string{"12e sur 340", "11e sur 340"}, 11, 340, "3e V1H"},
			{"another number ranked", map[string]any{"rank_of": 350}, nil, []string{"12e sur 340", "12e sur 350"}, 12, 350, "3e V1H"},
			{"another note", map[string]any{"note": "4e V1H"}, nil, []string{"3e V1H", "4e V1H"}, 12, 340, "4e V1H"},
			{"no note", nil, []string{"note"}, []string{"3e V1H"}, 12, 340, ""},
			{"no ranking", nil, []string{"rank", "rank_of"}, []string{"12e sur 340"}, 0, 0, "3e V1H"},
		} {
			t.Run(row.name, func(t *testing.T) {
				// Each row starts from the same result.
				update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H"})
				args := map[string]any{}
				for k, v := range same {
					args[k] = v
				}
				for k, v := range row.change {
					args[k] = v
				}
				for _, k := range row.drop {
					delete(args, k)
				}
				writesNothing(t, app, func() {
					_, message, details := asked(t, callTool(t, app, alice, "set_result", args))
					mentions(t, message, details, row.want...)
				})

				result := confirmAndCall(t, app, alice, "set_result", args)
				stored := storedRecord(t, app, "participations", fx.P1.Id)
				if stored.GetInt("rank") != row.rank || stored.GetInt("rank_of") != row.rankOf || stored.GetString("result_note") != row.note || stored.GetInt("finish_time_s") != 15150 {
					t.Errorf("the stored result is %d s, %d of %d, %q; want 15150 s, %d of %d, %q",
						stored.GetInt("finish_time_s"), stored.GetInt("rank"), stored.GetInt("rank_of"), stored.GetString("result_note"), row.rank, row.rankOf, row.note)
				}
				// The answer says the same.
				want := map[string]any{"finish_time": "4:12:30", "finish_time_s": 15150}
				if row.rank != 0 {
					want["rank"], want["rank_of"] = row.rank, row.rankOf
				}
				if row.note != "" {
					want["note"] = row.note
				}
				assertJSON(t, participationIn(t, result, "participation")["result"], want)
			})
		}
	})

	t.Run("a result that only fills a number ranked: it is not a result, so replacing it asks nothing", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		// What a person entered of it alone is no result for the site: nothing is shown.
		update(t, app, fx.P1, map[string]any{"status": "finished", "rank_of": 340})
		same := isDone(t, callTool(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P1.Id, "status": "finished"}))
		if _, has := participationIn(t, same, "participation")["result"]; has {
			t.Errorf("the participation shows a result: %v", participationIn(t, same, "participation"))
		}

		result := isDone(t, callTool(t, app, alice, "set_result", map[string]any{"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4:12:30"}))
		if want := "Terminé · 4h 12min 30s"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
		if stored := storedRecord(t, app, "participations", fx.P1.Id); stored.GetInt("rank_of") != 0 || stored.GetInt("finish_time_s") != 15150 {
			t.Errorf("the stored result is %d s of %d ranked, want the time and no number ranked", stored.GetInt("finish_time_s"), stored.GetInt("rank_of"))
		}
	})

	t.Run("dnf with a time: the hook drops it, the note stays, and the summary says so", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		result := isDone(t, callTool(t, app, alice, "set_result", map[string]any{
			"participation_id": fx.P1.Id, "status": "dnf", "finish_time": "5:00:00", "note": "abandon au km 30",
		}))
		stored := storedRecord(t, app, "participations", fx.P1.Id)
		if stored.GetString("status") != "dnf" || stored.GetInt("finish_time_s") != 0 || stored.GetString("result_note") != "abandon au km 30" {
			t.Errorf("the stored result is %s %d s %q, want dnf, no time, the note", stored.GetString("status"), stored.GetInt("finish_time_s"), stored.GetString("result_note"))
		}
		summary := summaryOfResult(result)
		if !strings.Contains(summary, "Abandon · abandon au km 30") || !strings.Contains(summary, "ne sont pas gardés") {
			t.Errorf("the summary is %q, want the result as written and that the time was not kept", summary)
		}
		assertJSON(t, participationIn(t, result, "participation")["result"], map[string]any{"note": "abandon au km 30"})
	})

	// What a status keeps of a result is the hook's (kept ports it): an abandon keeps
	// the note and nothing else. The summary says what was given and not kept, and
	// only then.
	t.Run("dnf: the time, the rank and the number ranked are not kept, and the summary says so", func(t *testing.T) {
		for _, row := range []struct {
			name string
			args map[string]any
		}{
			{"a time, a rank and a number ranked", map[string]any{"finish_time": "5:00:00", "rank": 10, "rank_of": 50}},
			{"a rank", map[string]any{"rank": 10}},
			// The number ranked alone is not a result, and is not kept either.
			{"a number ranked", map[string]any{"rank_of": 50}},
		} {
			t.Run(row.name, func(t *testing.T) {
				app, fx, alice := caseApp(t)
				args := map[string]any{"participation_id": fx.P1.Id, "status": "dnf", "note": "abandon au km 30"}
				for k, v := range row.args {
					args[k] = v
				}
				result := isDone(t, callTool(t, app, alice, "set_result", args))
				if !strings.Contains(summaryOfResult(result), "le temps et le classement ne sont pas gardés avec un abandon") {
					t.Errorf("the summary is %q, want it to say that what was given is not kept", summaryOfResult(result))
				}
				stored := storedRecord(t, app, "participations", fx.P1.Id)
				if stored.GetInt("finish_time_s") != 0 || stored.GetInt("rank") != 0 || stored.GetInt("rank_of") != 0 || stored.GetString("result_note") != "abandon au km 30" {
					t.Errorf("the stored result is %d s, %d of %d, %q; want only the note", stored.GetInt("finish_time_s"), stored.GetInt("rank"), stored.GetInt("rank_of"), stored.GetString("result_note"))
				}
			})
		}
	})

	t.Run("a result that has nothing to drop does not say that something was: a plain abandon, a finish", func(t *testing.T) {
		for _, given := range []map[string]any{
			{"status": "dnf"},
			{"status": "dnf", "note": "abandon au km 30"},
			{"status": "finished", "finish_time": "4:12:30", "rank": 12, "rank_of": 340},
		} {
			app, fx, alice := caseApp(t)
			args := map[string]any{"participation_id": fx.P1.Id}
			for k, v := range given {
				args[k] = v
			}
			result := isDone(t, callTool(t, app, alice, "set_result", args))
			if strings.Contains(summaryOfResult(result), "ne sont pas gardés") {
				t.Errorf("%v: the summary says that something was not kept: %q", args["status"], summaryOfResult(result))
			}
		}
	})

	t.Run("a result with no time: the rank alone", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		result := isDone(t, callTool(t, app, alice, "set_result", map[string]any{"participation_id": fx.P1.Id, "status": "finished", "rank": 1}))
		if want := "Terminé · 1er"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
	})

	t.Run("what the site refuses", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		_, future := newRace(t, app, fx, fx.AliceRunner, "Ultra du futur", "2099-06-13")
		planned := joined(t, app, fx.AliceRunner, future, "registered", true, fx.AliceRunner)

		refused(t, app, alice, "set_result", map[string]any{"participation_id": fx.P1.Id, "status": "finished", "rank": 400, "rank_of": 340},
			"classement : le classement dépasse le nombre de classés. (rank_above_total)")
		refused(t, app, alice, "set_result", map[string]any{"participation_id": planned.Id, "status": "finished", "finish_time": "1:00:00"},
			"la course n'a pas encore eu lieu. (status_before_race)")
		refused(t, app, alice, "set_result", map[string]any{"participation_id": fx.P1.Id, "status": "dnf", "note": strings.Repeat("a", 201)},
			"(validation_max_text_constraint)")
	})

	t.Run("what the tool announces", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		alone := joinedEvent(t, app, fx.AliceRunner, fx.Event2, "interested", true, fx.AliceRunner)
		update(t, app, fx.P2, map[string]any{"confirmed": true})

		for _, row := range []struct {
			name string
			args map[string]any
			want string
		}{
			{"a participation with no race", map[string]any{"participation_id": alone.Id, "status": "finished"}, "Choisis d'abord l'épreuve."},
			{"a participation confirmed by somebody else", map[string]any{"participation_id": fx.P2.Id, "status": "finished"},
				"Bob a confirmé cette participation : elle ne peut plus être changée que par Bob ou par un admin."},
			{"a time that is none", map[string]any{"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4h12"}, "finish_time"},
			{"a participation that is not there", map[string]any{"participation_id": "aaaaaaaaaaaaaaa", "status": "finished"}, "Introuvable : il a peut-être été supprimé."},
			{"an id that is not one", map[string]any{"participation_id": "P1", "status": "finished"}, "n'est pas un identifiant de participation"},
		} {
			t.Run(row.name, func(t *testing.T) {
				announced(t, app, alice, "set_result", row.args, row.want)
			})
		}
	})

	t.Run("somebody else's: a confirmation, then it is written", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		args := map[string]any{"participation_id": fx.P2.Id, "status": "finished", "finish_time": "5:01:02"}

		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "set_result", args))
			mentions(t, message, details, "Bob (Intéressé, non confirmé)", "d'un autre coureur", "« Trail 42 km »")
		})
		result := confirmAndCall(t, app, alice, "set_result", args)
		stored := storedRecord(t, app, "participations", fx.P2.Id)
		if stored.GetString("status") != "finished" || stored.GetInt("finish_time_s") != 5*3600+60+2 || stored.GetBool("confirmed") {
			t.Errorf("the stored participation is %s, %d s, confirmed %v", stored.GetString("status"), stored.GetInt("finish_time_s"), stored.GetBool("confirmed"))
		}
		if want := "non confirmé : Bob le verra dans « À confirmer »"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
	})
}
