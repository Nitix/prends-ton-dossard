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
// the backslash, the semicolon and the comma, and the line break, which becomes
// the two characters \n. It runs on a text that printable has cleaned, where
// the only line break left is the LF.
var textEscaper = strings.NewReplacer(
	`\`, `\\`,
	";", `\;`,
	",", `\,`,
	"\n", `\n`,
)

// printable returns v as something that can be written in a file: what is not
// valid UTF-8 becomes U+FFFD, and the control characters (C0 and DEL) are
// dropped, except the ones in keep. The texts of a feed are typed by the
// members, and a form request that is not JSON is not checked for UTF-8: a
// byte that starts no character cannot be cut or read, and a control character
// is refused by the calendar apps, or ends the line.
func printable(v, keep string) string {
	v = strings.ToValidUTF8(v, "�")
	return strings.Map(func(r rune) rune {
		if (r < 0x20 || r == 0x7f) && !strings.ContainsRune(keep, r) {
			return -1
		}
		return r
	}, v)
}

// textValue is a value of type TEXT, as it is written: cleaned, except for the
// tab and the line break, which are legal in a text (a CR is not a line break:
// a CRLF is one LF), then escaped.
func textValue(v string) string {
	return textEscaper.Replace(printable(v, "\t\n"))
}

// uriValue is a value of type URI, as it is written. It is not escaped (its
// commas and semicolons stay as they are), and holds no control character at
// all, so that no line break can start a property of its own.
func uriValue(v string) string {
	return printable(v, "")
}

// Feed returns the iCalendar file of the entries, in the order they are given,
// as of the moment now, which is the DTSTAMP of every event. The texts of the
// entries are already in the language lang ("fr" or "en"), which the file
// declares with its product, as RFC 5545 has it (3.7.3). An empty value is
// left out, except for the dates and the summary. The texts are cleaned of what
// a file cannot hold (see printable), whatever the entries hold.
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
		line("UID", textValue(entry.UID))
		line("DTSTAMP", stamp)
		line("DTSTART;VALUE=DATE", date(entry.Start))
		line("DTEND;VALUE=DATE", date(entry.End))
		line("SUMMARY", textValue(entry.Summary))
		optional("DESCRIPTION", textValue(entry.Description))
		optional("LOCATION", textValue(entry.Location))
		optional("URL", uriValue(entry.URL))
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
//
// It always moves forward: a line with no place to cut a character (a run of
// bytes that start none, so not valid UTF-8) is cut at the limit.
func fold(line string) string {
	var b strings.Builder
	limit := maxLineOctets
	for len(line) > limit {
		cut := limit
		// line[cut] starts the next piece: it must start a character.
		for cut > 0 && !utf8.RuneStart(line[cut]) {
			cut--
		}
		if cut == 0 {
			cut = limit
		}
		b.WriteString(line[:cut])
		b.WriteString("\r\n ")
		line = line[cut:]
		limit = maxLineOctets - 1
	}
	b.WriteString(line)
	return b.String()
}
