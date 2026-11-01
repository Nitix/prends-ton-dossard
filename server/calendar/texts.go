package calendar

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// words are the texts of a feed in one language. The site writes the same ones
// in web/src/i18n (fr.ts and en.ts) and its names in features/events/formatName.ts:
// the feed is read away from the site, so it cannot borrow them.
type words struct {
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

var texts = map[string]words{
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

// wordsOf returns the texts of the language, which are the French ones for a
// language that the site does not speak.
func wordsOf(lang string) words {
	if w, ok := texts[lang]; ok {
		return w
	}
	return texts["fr"]
}

// separator joins the parts of a title or of a status.
const separator = " · "

// statusText is what the description of a participation says of its status.
func (w words) statusText(status string, confirmed bool) string {
	text, ok := w.status[status]
	if !ok {
		text = status
	}
	if !confirmed {
		text += separator + w.unconfirmed
	}
	return text
}

// raceName is what a race is called, as the site does (formatDisplayName): the
// name that was typed, otherwise its type and its main measure, which is its
// distance, otherwise its duration, otherwise its time limit ("Trail 42,2 km",
// "Route 6h", "Backyard max 48h"). A race with no measure is called by its type.
func (w words) raceName(name, typeLabel string, distanceKm float64, durationMin, timeLimitMin int) string {
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
func (w words) km(distance float64) string {
	text := strconv.FormatFloat(math.Round(distance*10)/10, 'f', -1, 64)
	return strings.Replace(text, ".", w.decimal, 1) + " km"
}

// duration writes a number of minutes as hours and minutes, leaving out the
// unit that is zero: "1h 30min", "48h", "45min".
func (w words) duration(minutes int) string {
	var parts []string
	if hours := minutes / 60; hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if rest := minutes % 60; rest > 0 {
		parts = append(parts, fmt.Sprintf("%d%s", rest, w.minute))
	}
	return strings.Join(parts, " ")
}
