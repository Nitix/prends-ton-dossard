package wording

import (
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
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
