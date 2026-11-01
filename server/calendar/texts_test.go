package calendar

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

// The feed is read away from the site, so it has the words of the site of its
// own (texts.go): the labels of the statuses and "not confirmed". They are the
// ones of web/src/i18n, which this test reads: a label that changes on one side
// only, or a status that is added, fails here.
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
				t.Errorf("the labels of the statuses in texts.go are %q, in %s.ts %q", w.status, lang, site)
			}

			word := unconfirmed.FindStringSubmatch(source)
			if word == nil {
				t.Fatalf("no `unconfirmed: \"...\"` in %s.ts", lang)
			}
			if word[1] != w.unconfirmed {
				t.Errorf("the word for a participation that is not confirmed is %q in texts.go, %q in %s.ts", w.unconfirmed, word[1], lang)
			}
		})
	}
}
