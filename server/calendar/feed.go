// Package calendar holds the calendar link of an account and the iCalendar feed
// that a calendar app reads at that address: the races of the runner of the
// account and the days that registrations close.
//
// The link carries a random token in its path, since a calendar app can only
// ask for an address. Only the SHA-256 of the token is stored, as for the
// invitations (see the invitations package).
package calendar

import (
	"strings"
	"time"
	"unicode/utf8"
)

// Entry is one event of a feed, of one or several whole days.
type Entry struct {
	// UID names the event for good: a calendar app that reads the feed again
	// updates the event with that UID, and adds one for each UID it has not
	// seen, so it must not change from one reading to the next.
	UID         string
	Summary     string
	Description string
	Location    string
	URL         string
	// Start is the first day, and End the day after the last one: the end of an
	// event of whole days is exclusive in iCalendar. Both are YYYY-MM-DD.
	Start, End string
}

// maxLineOctets is the longest line of an iCalendar file, the line break not
// counted (RFC 5545, 3.1).
const maxLineOctets = 75

// stampLayout is a date and time in UTC in iCalendar (RFC 5545, 3.3.5).
const stampLayout = "20060102T150405Z"

// textEscaper escapes what a TEXT value cannot hold as it is (RFC 5545, 3.3.11):
// the backslash, the semicolon and the comma, and every line break, which
// becomes the two characters \n. The pairs are tried in this order, so that a
// CRLF is one line break.
var textEscaper = strings.NewReplacer(
	`\`, `\\`,
	";", `\;`,
	",", `\,`,
	"\r\n", `\n`,
	"\n", `\n`,
	"\r", `\n`,
)

// uriCleaner takes the line breaks out of a URI value, which is not escaped
// (its commas and semicolons stay as they are) and so could not otherwise
// keep a line break from starting a property of its own.
var uriCleaner = strings.NewReplacer("\r", "", "\n", "")

// Feed returns the iCalendar file of the entries, in the order they are given,
// as of the moment now, which is the DTSTAMP of every event. The texts of the
// entries are already in the language lang ("fr" or "en"), which the file
// declares with its product, as RFC 5545 has it (3.7.3). An empty value is
// left out, except for the dates and the summary.
func Feed(entries []Entry, lang string, now time.Time) string {
	var b strings.Builder
	line := func(name, value string) {
		b.WriteString(fold(name + ":" + value))
		b.WriteString("\r\n")
	}
	optional := func(name, value string) {
		if value != "" {
			line(name, value)
		}
	}

	line("BEGIN", "VCALENDAR")
	line("VERSION", "2.0")
	line("PRODID", "-//Prends ton dossard//"+strings.ToUpper(lang))
	line("X-WR-CALNAME", "Prends ton dossard")
	line("CALSCALE", "GREGORIAN")

	stamp := now.UTC().Format(stampLayout)
	for _, entry := range entries {
		line("BEGIN", "VEVENT")
		line("UID", textEscaper.Replace(entry.UID))
		line("DTSTAMP", stamp)
		line("DTSTART;VALUE=DATE", date(entry.Start))
		line("DTEND;VALUE=DATE", date(entry.End))
		line("SUMMARY", textEscaper.Replace(entry.Summary))
		optional("DESCRIPTION", textEscaper.Replace(entry.Description))
		optional("LOCATION", textEscaper.Replace(entry.Location))
		optional("URL", uriCleaner.Replace(entry.URL))
		line("END", "VEVENT")
	}
	line("END", "VCALENDAR")
	return b.String()
}

// date turns a day written YYYY-MM-DD into the DATE value of iCalendar.
func date(day string) string {
	return strings.ReplaceAll(day, "-", "")
}

// fold cuts a content line into lines of at most 75 octets, each one after the
// first starting with the space that marks it as a continuation, which counts
// in its length (RFC 5545, 3.1). It never cuts a character in two.
func fold(line string) string {
	var b strings.Builder
	limit := maxLineOctets
	for len(line) > limit {
		cut := limit
		// line[cut] starts the next piece: it must start a character.
		for cut > 0 && !utf8.RuneStart(line[cut]) {
			cut--
		}
		b.WriteString(line[:cut])
		b.WriteString("\r\n ")
		line = line[cut:]
		limit = maxLineOctets - 1
	}
	b.WriteString(line)
	return b.String()
}
