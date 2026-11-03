package wording

import (
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"testing"
)

// i18nFile reads web/src/i18n/<lang>.ts, from the place of this file.
func i18nFile(t *testing.T, lang string) string {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot tell where this test file is")
	}
	source, err := os.ReadFile(filepath.Join(filepath.Dir(here), "..", "..", "web", "src", "i18n", lang+".ts"))
	if err != nil {
		t.Fatal(err)
	}
	return string(source)
}

// What is read away from the site (the calendar feed, the MCP tools) has the
// words of the site of its own (words.go): the labels of the statuses and "not
// confirmed". They are the ones of web/src/i18n, which this test reads: a label
// that changes on one side only, or a status that is added, fails here.
func TestTexts_SameWordsAsTheSite(t *testing.T) {
	statusBlock := regexp.MustCompile(`(?s)\n  status: \{(.*?)\n  \}`)
	statusLine := regexp.MustCompile(`(\w+): "([^"]*)",`)
	unconfirmed := regexp.MustCompile(`(?m)^\s+unconfirmed: "([^"]*)",$`)

	for lang, w := range texts {
		t.Run(lang, func(t *testing.T) {
			source := i18nFile(t, lang)

			block := statusBlock.FindStringSubmatch(source)
			if block == nil {
				t.Fatalf("no `status: {...}` block in %s.ts", lang)
			}
			site := map[string]string{}
			for _, line := range statusLine.FindAllStringSubmatch(block[1], -1) {
				site[line[1]] = line[2]
			}
			if !maps.Equal(w.status, site) {
				t.Errorf("the labels of the statuses in words.go are %q, in %s.ts %q", w.status, lang, site)
			}

			word := unconfirmed.FindStringSubmatch(source)
			if word == nil {
				t.Fatalf("no `unconfirmed: \"...\"` in %s.ts", lang)
			}
			if word[1] != w.unconfirmed {
				t.Errorf("the word for a participation that is not confirmed is %q in words.go, %q in %s.ts", w.unconfirmed, word[1], lang)
			}
		})
	}
}

func TestWords_Status(t *testing.T) {
	for _, row := range []struct {
		lang, status, want string
	}{
		{"fr", "registered", "Inscrit"},
		{"fr", "dns", "Non partant"},
		{"en", "registered", "Registered"},
		// A language that the site does not speak is French.
		{"de", "interested", "Intéressé"},
		// A status that is not one is said as it is.
		{"fr", "lost", "lost"},
	} {
		if got := Of(row.lang).Status(row.status); got != row.want {
			t.Errorf("Of(%q).Status(%q) = %q, want %q", row.lang, row.status, got, row.want)
		}
	}

	if got := Of("fr").StatusText("registered", true); got != "Inscrit" {
		t.Errorf("a confirmed participation is %q, want %q", got, "Inscrit")
	}
	if got := Of("fr").StatusText("interested", false); got != "Intéressé"+Separator+"non confirmé" {
		t.Errorf("an unconfirmed participation is %q", got)
	}
	if got := Of("en").Deadline(); got != "Registration closes" {
		t.Errorf("the English deadline is %q", got)
	}
	if got := Of("fr").Deadline(); got != "Clôture des inscriptions" {
		t.Errorf("the French deadline is %q", got)
	}
}

// The names of the races, as the site writes them: the cases of
// formatName.test.ts (formatDisplayName).
func TestRaceName(t *testing.T) {
	for _, row := range []struct {
		name      string
		lang      string
		typed     string
		label     string
		distance  float64
		duration  int
		timeLimit int
		want      string
	}{
		{name: "the type and the distance, with at most one decimal", lang: "fr", label: "Trail", distance: 42.195, want: "Trail 42,2 km"},
		{name: "a round distance has no decimal", lang: "fr", label: "Trail", distance: 15, want: "Trail 15 km"},
		{name: "the type and the duration of a timed race", lang: "fr", label: "Route", duration: 360, want: "Route 6h"},
		{name: "hours and minutes", lang: "fr", label: "Route", duration: 2790, want: "Route 46h 30min"},
		{name: "minutes only", lang: "fr", label: "Route", duration: 45, want: "Route 45min"},
		{name: "the type and the time limit when that is all there is", lang: "fr", label: "Backyard", timeLimit: 2880, want: "Backyard max 48h"},
		{name: "the name typed by the user wins over everything", lang: "fr", typed: "Les 6 heures de Bron", label: "Route", distance: 42, duration: 360, want: "Les 6 heures de Bron"},
		{name: "a name of blanks is no name", lang: "fr", typed: "  ", label: "Route", distance: 10, want: "Route 10 km"},
		{name: "the distance wins over the duration", lang: "fr", label: "Route", distance: 10, duration: 360, timeLimit: 600, want: "Route 10 km"},
		{name: "the duration wins over the time limit", lang: "fr", label: "Route", duration: 360, timeLimit: 600, want: "Route 6h"},
		{name: "an empty value is absent (duration)", lang: "fr", typed: "", label: "Route", duration: 360, want: "Route 6h"},
		{name: "an empty value is absent (time limit)", lang: "fr", label: "Backyard", timeLimit: 2880, want: "Backyard max 48h"},
		{name: "a race with no measure is called by its type", lang: "fr", label: "Cross", want: "Cross"},
		{name: "English numbers", lang: "en", label: "Trail", distance: 42.195, want: "Trail 42.2 km"},
		{name: "English time limit", lang: "en", label: "Backyard", timeLimit: 2790, want: "Backyard max 46h 30m"},
		{name: "a language that the site does not speak is French", lang: "de", label: "Trail", distance: 42.195, want: "Trail 42,2 km"},
	} {
		t.Run(row.name, func(t *testing.T) {
			got := Of(row.lang).RaceName(row.typed, row.label, row.distance, row.duration, row.timeLimit)
			if got != row.want {
				t.Errorf("RaceName = %q, want %q", got, row.want)
			}
		})
	}
}

// The letters of the migration 9i (defaultMeasures), and the blanks of a name
// that is typed: what is compared is the same whatever the case, the accents,
// the hyphens and the spaces around.
func TestFold(t *testing.T) {
	for _, row := range []struct{ in, want string }{
		{"", ""},
		{"Crête", "crete"},
		{"ÉLODIE", "elodie"},
		{"Saint-Étienne", "saint etienne"},
		{"l'Aigle", "l aigle"},
		{"l’Aigle", "l aigle"},
		{"ultra_trail", "ultra trail"},
		{"Cœur d'Alène", "coeur d alene"},
		{"Ça va, où ?", "ca va, ou ?"},
		{"àâäá éèêë îïí ôöó ùûüú çñæ", "aaaa eeee iii ooo uuuu cnae"},
		{"  Trail   des  Crêtes ", "trail des cretes"},
		{"Backyard", "backyard"},
	} {
		if got := Fold(row.in); got != row.want {
			t.Errorf("Fold(%q) = %q, want %q", row.in, got, row.want)
		}
	}
}

// A time of a race, as the site writes it: the cases of format.test.ts (raceTime).
// Narrow style, no space between a number and its unit.
func TestRaceTime(t *testing.T) {
	for _, row := range []struct {
		name    string
		lang    string
		seconds int
		want    string
	}{
		// raceTime — heures, minutes, secondes.
		{"hours, minutes, seconds", "fr", 15130, "4h 12min 10s"},
		{"hours, minutes, seconds, in English", "en", 15150, "4h 12m 30s"},
		// raceTime — une unité qui est zéro est omise, sauf entre deux autres.
		{"hours only", "fr", 14400, "4h"},
		{"minutes only", "fr", 2520, "42min"},
		{"minutes and seconds", "fr", 125, "2min 5s"},
		{"seconds only", "fr", 59, "59s"},
		{"a zero in the middle is told", "fr", 3605, "1h 0min 5s"},
		{"a zero in the middle is told, in English", "en", 3605, "1h 0m 5s"},
		// raceTime — plus de 24 heures, sans passer aux jours.
		{"more than 24 hours", "fr", 100*3600 + 30*60, "100h 30min"},
		// Not cases of the site's tests, but what Intl.DurationFormat writes.
		{"hours and seconds with minutes", "fr", 3661, "1h 1min 1s"},
		{"a whole minute", "fr", 60, "1min"},
		{"a whole hour", "fr", 3600, "1h"},
		{"hours and minutes", "en", 3660, "1h 1m"},
		{"nothing", "fr", 0, ""},
		// A language that the site does not speak is French.
		{"another language", "de", 15150, "4h 12min 30s"},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := Of(row.lang).RaceTime(row.seconds); got != row.want {
				t.Errorf("RaceTime(%d) = %q, want %q", row.seconds, got, row.want)
			}
		})
	}
}

// A rank in words, agreeing with its number: the cases of format.test.ts (ordinal).
func TestOrdinal(t *testing.T) {
	for _, row := range []struct {
		lang string
		in   []int
		want []string
	}{
		// ordinal — 1er, 2e, 12e.
		{"fr", []int{1, 2, 3, 12, 21, 100}, []string{"1er", "2e", "3e", "12e", "21e", "100e"}},
		// ordinal — 1st, 2nd, 12th.
		{"en", []int{1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101}, []string{"1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"}},
		// What Intl.PluralRules answers beyond the site's cases.
		{"fr", []int{0, 11, 101, 111}, []string{"0e", "11e", "101e", "111e"}},
		{"en", []int{0, 111, 112, 113, 1001}, []string{"0th", "111th", "112th", "113th", "1001st"}},
		// A language that the site does not speak is French.
		{"de", []int{1, 2}, []string{"1er", "2e"}},
	} {
		t.Run(row.lang, func(t *testing.T) {
			var got []string
			for _, n := range row.in {
				got = append(got, Of(row.lang).Ordinal(n))
			}
			if !slices.Equal(got, row.want) {
				t.Errorf("Ordinal of %v = %q, want %q", row.in, got, row.want)
			}
		})
	}
}

// What the site writes of a result, in parts to join with Separator: the cases of
// resultText.test.ts (resultParts).
func TestResultParts(t *testing.T) {
	for _, row := range []struct {
		name                      string
		lang                      string
		finishTimeS, rank, rankOf int
		note                      string
		want                      []string
	}{
		{"resultParts — temps, rang sur nombre, note", "fr", 15150, 12, 340, "3e V1H", []string{"4h 12min 30s", "12e sur 340", "3e V1H"}},
		{"resultParts — temps, rang sur nombre, note (English)", "en", 15150, 12, 340, "3e V1H", []string{"4h 12m 30s", "12th out of 340", "3e V1H"}},
		{"resultParts — rang sans nombre", "fr", 0, 12, 0, "", []string{"12e"}},
		{"resultParts — rang sans nombre, le premier", "fr", 0, 1, 0, "", []string{"1er"}},
		{"resultParts — rang sans nombre (English)", "en", 0, 12, 0, "", []string{"12th"}},
		{"resultParts — rien sans résultat", "fr", 0, 0, 0, "", nil},
		{"resultParts — le nombre de classés seul ne dit rien, une note de blancs non plus", "fr", 0, 0, 340, "   ", nil},
		{"resultParts — la note seule, un abandon par exemple", "fr", 0, 0, 0, "abandon au km 30", []string{"abandon au km 30"}},
		{"the note is trimmed", "fr", 0, 0, 0, "  3e V1H \n", []string{"3e V1H"}},
		{"a time alone", "fr", 3605, 0, 0, "", []string{"1h 0min 5s"}},
	} {
		t.Run(row.name, func(t *testing.T) {
			got := Of(row.lang).ResultParts(row.finishTimeS, row.rank, row.rankOf, row.note)
			if !slices.Equal(got, row.want) {
				t.Errorf("ResultParts = %q, want %q", got, row.want)
			}
		})
	}
}

// The word that joins a rank and the number of people ranked ("12e sur 340") is
// the one of the site's rankText: the same test as for the statuses.
func TestTexts_SameRankWordAsTheSite(t *testing.T) {
	// The text of the template literal, between its backticks, is the one that counts.
	rankText := regexp.MustCompile(`(?m)^\s+rankText: \(rank: string, of\?: string\) => \(of === undefined \? rank : ` +
		"`" + `\$\{rank\} (.+?) \$\{of\}` + "`" + `\),$`)

	for lang, w := range texts {
		t.Run(lang, func(t *testing.T) {
			word := rankText.FindStringSubmatch(i18nFile(t, lang))
			if word == nil {
				t.Fatalf("no `rankText: (rank, of) => ...` in %s.ts", lang)
			}
			if word[1] != w.rankOf {
				t.Errorf("the word between a rank and the number ranked is %q in words.go, %q in %s.ts", w.rankOf, word[1], lang)
			}
		})
	}
}
