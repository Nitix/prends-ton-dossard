// Package wording has the texts of the site that are read away from it: the
// calendar feed and the MCP tools say a status, a deadline or the name of a race
// as the site does, in the language of the reader.
package wording

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Words are the texts of the site in one language, for what is read away from it
// (the calendar feed, the MCP tools). The same ones as web/src/i18n (the test
// reads them), and its names in features/events/formatName.ts: what is read away
// from the site cannot borrow them.
type Words struct {
	// status is the label of each status of a participation.
	status map[string]string
	// unconfirmed is added to the status of a participation that its runner has
	// not confirmed.
	unconfirmed string
	// deadline is what the day that registrations close is called.
	deadline string
	// decimal is the separator of the decimals of a distance.
	decimal string
	// minute is the unit of the minutes of a duration, in the narrow style of
	// Intl.DurationFormat ("46h 30min", "46h 30m").
	minute string
}

var texts = map[string]Words{
	"fr": {
		status: map[string]string{
			"interested": "Intéressé",
			"registered": "Inscrit",
			"finished":   "Terminé",
			"dnf":        "Abandon",
			"dns":        "Non partant",
			"supporter":  "Supporteur",
		},
		unconfirmed: "non confirmé",
		deadline:    "Clôture des inscriptions",
		decimal:     ",",
		minute:      "min",
	},
	"en": {
		status: map[string]string{
			"interested": "Interested",
			"registered": "Registered",
			"finished":   "Finished",
			"dnf":        "DNF",
			"dns":        "DNS",
			"supporter":  "Supporter",
		},
		unconfirmed: "not confirmed",
		deadline:    "Registration closes",
		decimal:     ".",
		minute:      "m",
	},
}

// Of returns the texts of the language, which are the French ones for a
// language that the site does not speak.
func Of(lang string) Words {
	if w, ok := texts[lang]; ok {
		return w
	}
	return texts["fr"]
}

// Separator joins the parts of a title or of a status.
const Separator = " · "

// Status is the label of a status of a participation ("Inscrit"): the status
// itself when it is not one that the site knows.
func (w Words) Status(status string) string {
	if text, ok := w.status[status]; ok {
		return text
	}
	return status
}

// StatusText is what the description of a participation says of its status.
func (w Words) StatusText(status string, confirmed bool) string {
	text := w.Status(status)
	if !confirmed {
		text += Separator + w.unconfirmed
	}
	return text
}

// Deadline is what the day that registrations close is called.
func (w Words) Deadline() string {
	return w.deadline
}

// RaceName is what a race is called, as the site does (formatDisplayName): the
// name that was typed, otherwise its type and its main measure, which is its
// distance, otherwise its duration, otherwise its time limit ("Trail 42,2 km",
// "Route 6h", "Backyard max 48h"). A race with no measure is called by its type.
func (w Words) RaceName(name, typeLabel string, distanceKm float64, durationMin, timeLimitMin int) string {
	if name = strings.TrimSpace(name); name != "" {
		return name
	}
	switch {
	case distanceKm != 0:
		return typeLabel + " " + w.km(distanceKm)
	case durationMin != 0:
		return typeLabel + " " + w.duration(durationMin)
	case timeLimitMin != 0:
		return typeLabel + " max " + w.duration(timeLimitMin)
	}
	return typeLabel
}

// km writes a distance with at most one decimal: "42,2 km", "10 km".
func (w Words) km(distance float64) string {
	text := strconv.FormatFloat(math.Round(distance*10)/10, 'f', -1, 64)
	return strings.Replace(text, ".", w.decimal, 1) + " km"
}

// duration writes a number of minutes as hours and minutes, leaving out the
// unit that is zero: "1h 30min", "48h", "45min".
func (w Words) duration(minutes int) string {
	var parts []string
	if hours := minutes / 60; hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if rest := minutes % 60; rest > 0 {
		parts = append(parts, fmt.Sprintf("%d%s", rest, w.minute))
	}
	return strings.Join(parts, " ")
}

// folded writes the French letters that carry an accent without it: the ones of
// the migration 9i_race_type_measures.go, which compares the names of the race
// types the same way.
var folded = strings.NewReplacer(
	"à", "a", "â", "a", "ä", "a", "á", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"î", "i", "ï", "i", "í", "i",
	"ô", "o", "ö", "o", "ó", "o", "œ", "oe",
	"ù", "u", "û", "u", "ü", "u", "ú", "u",
	"ç", "c", "ñ", "n", "æ", "ae",
	// A hyphen, an apostrophe or an underscore separates words, as a space does.
	"-", " ", "_", " ", "'", " ", "’", " ",
)

// Fold writes a text in lower case without the French accents, a hyphen, an
// apostrophe or an underscore becoming a space, and the blanks around and
// between the words reduced to one space: two names that Fold writes alike are
// the same name for whoever asks for a runner, a type or a race by its name.
func Fold(s string) string {
	return strings.Join(strings.Fields(folded.Replace(strings.ToLower(s))), " ")
}
