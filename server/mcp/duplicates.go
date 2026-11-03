package mcp

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"courses/server/events"
	"courses/server/wording"
)

// The likely duplicates of a race, as the form of the site proposes them
// (web/src/features/events/duplicates.ts): the events that start within 30
// days of its first day, whose name has a word of four letters or more of its
// name.

const (
	duplicateWindowDays = 30 // WINDOW_DAYS
	minWordLetters      = 4  // MIN_LETTERS
)

// significantWords is significantWords of duplicates.ts: the words of a name
// that are worth looking for, four letters or more, in lower case, each once.
// Figures do not count, and an apostrophe or a hyphen separates two words. The
// name is composed first (normalize("NFC")), so that an accent typed as a mark
// of its own stays in its word: see composeAccents.
func significantWords(name string) []string {
	var words []string
	for _, word := range strings.FieldsFunc(strings.ToLower(composeAccents(name)), func(r rune) bool { return !unicode.IsLetter(r) }) {
		// JavaScript counts the length of a text in UTF-16 units.
		if len(utf16.Encode([]rune(word))) >= minWordLetters && !slices.Contains(words, word) {
			words = append(words, word)
		}
	}
	return words
}

// accents are the letters that a base letter and a combining mark make, for the
// marks of French and of its neighbours (grave, acute, circumflex, tilde,
// diaeresis, ring, cedilla): the compositions of normalize("NFC") that a name of
// the group can need. A mark that follows no letter of these stays as it is.
var accents = func() map[[2]rune]rune {
	marks := []struct {
		mark          rune
		bases, letter string
	}{
		{'̀', "aeiouAEIOU", "àèìòùÀÈÌÒÙ"},
		{'́', "aeiouyAEIOUY", "áéíóúýÁÉÍÓÚÝ"},
		{'̂', "aeiouAEIOU", "âêîôûÂÊÎÔÛ"},
		{'̃', "anoANO", "ãñõÃÑÕ"},
		{'̈', "aeiouyAEIOUY", "äëïöüÿÄËÏÖÜŸ"},
		{'̊', "aA", "åÅ"},
		{'̧', "cC", "çÇ"},
	}
	table := map[[2]rune]rune{}
	for _, m := range marks {
		letters := []rune(m.letter)
		for i, base := range m.bases {
			table[[2]rune{base, m.mark}] = letters[i]
		}
	}
	return table
}()

// composeAccents writes a letter followed by a combining accent as the one
// letter it makes (see accents).
func composeAccents(s string) string {
	runes := []rune(s)
	out := make([]rune, 0, len(runes))
	for _, r := range runes {
		if n := len(out); n > 0 {
			if composed, ok := accents[[2]rune{out[n-1], r}]; ok {
				out[n-1] = composed
				continue
			}
		}
		out = append(out, r)
	}
	return string(out)
}

// duplicates is significantWords of web/src/features/events/duplicates.ts, and its search in
// two steps: the API is asked for the events that start within 30 days of start (the days are
// checked with events.ParseDay; the name never goes into the filter, see the Global constraints),
// then Go keeps those, but exceptID, whose lower-cased name contains one of the words. A name
// with no word of four letters asks nothing.
func (t *tools) duplicates(ctx context.Context, name, start, exceptID string) ([]eventSummary, error) {
	views, err := t.duplicateViews(ctx, name, start, exceptID)
	if err != nil {
		return nil, err
	}
	out := make([]eventSummary, 0, len(views))
	w := wording.Of("fr")
	for _, v := range views {
		out = append(out, v.summary(t.cfg, w, ""))
	}
	return out, nil
}

// duplicateViews are the likely duplicates (see duplicates), as views: the
// confirmation of create_event names them, and its state has their records.
// A start that is not a day has none.
func (t *tools) duplicateViews(ctx context.Context, name, start, exceptID string) ([]eventView, error) {
	words := significantWords(name)
	day, ok := events.ParseDay(start)
	if len(words) == 0 || !ok {
		return nil, nil
	}
	from := day.AddDate(0, 0, -duplicateWindowDays).Format(time.DateOnly)
	to := day.AddDate(0, 0, duplicateWindowDays).Format(time.DateOnly)
	views, err := t.eventViews(ctx, "start_date >= '"+from+"' && start_date <= '"+to+"'", "start_date")
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(views, func(v eventView) bool {
		if v.record.ID == exceptID {
			return true
		}
		lower := strings.ToLower(composeAccents(v.record.Name))
		return !slices.ContainsFunc(words, func(word string) bool { return strings.Contains(lower, word) })
	}), nil
}
