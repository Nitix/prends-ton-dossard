// Package wording has the texts of the site that are read away from it: the
// calendar feed and the MCP tools say a status, a deadline or the name of a race
// as the site does, in the language of the reader.
package wording

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
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
	// opening is what the day that registrations open is called.
	opening string
	// dateToBeSet is what a race known by its month only says of its day.
	dateToBeSet string
	// undecided, supporters and groupName are the texts of the group calendar:
	// the line of those interested who have not chosen a race, the line of the
	// supporters, and the name of the calendar.
	undecided, supporters, groupName string
	// colon is what follows the name of a race, or of a group of people, before
	// those it holds (a space comes before it in French).
	colon string
	// reminder holds the pieces of the body of a reminder of an opening.
	reminder reminderWords
	// decimal is the separator of the decimals of a distance.
	decimal string
	// minute is the unit of the minutes of a duration, in the narrow style of
	// Intl.DurationFormat ("46h 30min", "46h 30m").
	minute string
	// rankOf is what stands between a rank and the number of people ranked
	// ("12e sur 340", "12th out of 340"): the word of rankText of the site.
	rankOf string
	// ending is the ending of an ordinal number agreeing with its number: "er" for
	// 1 in French, "st" for 21 in English (the plural rules of the language).
	ending func(n int) string
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
		opening:     "Ouverture des inscriptions",
		dateToBeSet: "date à préciser",
		undecided:   "Intéressés, format à choisir",
		supporters:  "Supporteurs",
		groupName:   "Prends ton dossard · groupe",
		colon:       " : ",
		reminder:    reminderWords{opens: "Les inscriptions ouvrent", today: "aujourd'hui", tomorrow: "demain", at: "à", in: "dans", min: "min"},
		decimal:     ",",
		minute:      "min",
		rankOf:      "sur",
		// Only 1 has a form of its own.
		ending: func(n int) string {
			if n == 1 {
				return "er"
			}
			return "e"
		},
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
		opening:     "Registration opens",
		dateToBeSet: "date to be set",
		undecided:   "Interested, format to be chosen",
		supporters:  "Supporters",
		groupName:   "Prends ton dossard · group",
		colon:       ": ",
		reminder:    reminderWords{opens: "Registration opens", today: "today", tomorrow: "tomorrow", at: "at", in: "in", min: "min"},
		decimal:     ".",
		minute:      "m",
		rankOf:      "out of",
		ending: func(n int) string {
			switch {
			case n%10 == 1 && n%100 != 11:
				return "st"
			case n%10 == 2 && n%100 != 12:
				return "nd"
			case n%10 == 3 && n%100 != 13:
				return "rd"
			}
			return "th"
		},
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

// RaceTime writes a time of a race given in seconds as the site does (raceTime of
// lib/format.ts), in the narrow style of Intl.DurationFormat: no space between a
// number and its unit, a unit that is zero left out, but for the minutes between
// the hours and the seconds ("1h 0min 5s", not "1h 5s"). There is no day: "100h
// 30min". "4h 12min 30s", "42min", "59s"; in English "4h 12m 30s".
func (w Words) RaceTime(seconds int) string {
	hours, minutes, rest := seconds/3600, seconds%3600/60, seconds%60
	var parts []string
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 || (hours > 0 && rest > 0) {
		parts = append(parts, fmt.Sprintf("%d%s", minutes, w.minute))
	}
	if rest > 0 {
		parts = append(parts, fmt.Sprintf("%ds", rest))
	}
	return strings.Join(parts, " ")
}

// Ordinal writes a rank in words, agreeing with its number, as the site does
// (ordinal of lib/format.ts): "1er", "2e", "12e" in French; "1st", "2nd", "3rd",
// "4th", "11th" in English.
func (w Words) Ordinal(n int) string {
	return strconv.Itoa(n) + w.ending(n)
}

// ResultParts is what the site writes of a result (resultParts of
// features/results/resultText.ts), as the parts of a line to be joined with
// Separator: the time ("4h 12min 30s"), the rank, with how many were ranked when
// it is known ("12e sur 340", or "12e"), then the note, without the blanks around
// it. A part that is not given (0 and "") is left out: none at all without a
// result, and the number of people ranked alone is not one.
func (w Words) ResultParts(finishTimeS, rank, rankOf int, note string) []string {
	var parts []string
	if finishTimeS != 0 {
		parts = append(parts, w.RaceTime(finishTimeS))
	}
	if rank != 0 {
		text := w.Ordinal(rank)
		if rankOf != 0 {
			text += " " + w.rankOf + " " + strconv.Itoa(rankOf)
		}
		parts = append(parts, text)
	}
	if note = strings.TrimSpace(note); note != "" {
		parts = append(parts, note)
	}
	return parts
}

// Opening is what the day that registrations open is called.
func (w Words) Opening() string {
	return w.opening
}

// reminderWords are the pieces of the body of a reminder of an opening.
type reminderWords struct{ opens, today, tomorrow, at, in, min string }

// parisZone is Paris, loaded once: the days and hours of an opening are the wall
// clock of Paris, as everywhere on the site.
var parisZone = sync.OnceValue(func() *time.Location {
	zone, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		// The program embeds time/tzdata; a build that does not reads UTC.
		return time.UTC
	}
	return zone
})

// ReminderBody is the body of the reminder of an opening at T, sent at now (spec
// § 4.3). More than 2 hours before, it says the day, "demain" or "aujourd'hui"
// by the days of Paris, and the hour when there is one (timeKnown); within 2
// hours, what is left, "à 10:00, dans 45 min" (the minutes are counted up, so
// that the text never says 0). An opening with no hour says the day only.
func (w Words) ReminderBody(T time.Time, timeKnown bool, now time.Time) string {
	r := w.reminder
	paris := parisZone()
	left := T.Sub(now)
	hhmm := T.In(paris).Format("15:04")
	if timeKnown && left <= 2*time.Hour {
		minutes := max(int((left+time.Minute-1)/time.Minute), 1)
		return fmt.Sprintf("%s %s %s, %s %d %s.", r.opens, r.at, hhmm, r.in, minutes, r.min)
	}
	day := r.tomorrow
	ty, tm, td := T.In(paris).Date()
	if ny, nm, nd := now.In(paris).Date(); ty == ny && tm == nm && td == nd {
		day = r.today
	}
	if timeKnown {
		return fmt.Sprintf("%s %s %s %s.", r.opens, day, r.at, hhmm)
	}
	return fmt.Sprintf("%s %s.", r.opens, day)
}

// DateToBeSet is what a race known by its month only says of its day: "date à
// préciser", "date to be set".
func (w Words) DateToBeSet() string {
	return w.dateToBeSet
}

// GroupName is the name of the calendar of the group: "Prends ton dossard ·
// groupe".
func (w Words) GroupName() string {
	return w.groupName
}

// Undecided is the label of those who are interested in a race and have not
// chosen a format: "Intéressés, format à choisir".
func (w Words) Undecided() string {
	return w.undecided
}

// Supporters is the label of those who come to support: "Supporteurs".
func (w Words) Supporters() string {
	return w.supporters
}

// Roster is a line of the description of a race in the group calendar: the label,
// the colon of the language, then the people, which are written as they are given
// and joined by a comma and a space ("Trail 42 km : Alice (Inscrit), Bob").
func (w Words) Roster(label string, people []string) string {
	return label + w.colon + strings.Join(people, ", ")
}
