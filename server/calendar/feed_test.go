package calendar_test

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"courses/server/calendar"
)

// now is the clock of the tests: DTSTAMP is the only line of a feed that comes
// from it.
var now = time.Date(2026, time.November, 1, 9, 30, 15, 0, time.UTC)

// lines splits a feed into its lines, checking on the way that each one ends
// with CRLF and nothing else does.
func lines(t *testing.T, feed string) []string {
	t.Helper()
	if !strings.HasSuffix(feed, "\r\n") {
		t.Fatalf("the feed must end with CRLF, got %q", feed[max(0, len(feed)-10):])
	}
	parts := strings.Split(strings.TrimSuffix(feed, "\r\n"), "\r\n")
	for _, part := range parts {
		if strings.ContainsAny(part, "\r\n") {
			t.Fatalf("a bare CR or LF in the line %q: only CRLF may end a line", part)
		}
	}
	return parts
}

// unfold gives back the content lines of a feed: a line that starts with a
// space continues the one before it (RFC 5545, 3.1).
func unfold(feed string) []string {
	return strings.Split(strings.TrimSuffix(strings.ReplaceAll(feed, "\r\n ", ""), "\r\n"), "\r\n")
}

func TestFeed_Structure(t *testing.T) {
	t.Run("an empty feed is a valid calendar with no event", func(t *testing.T) {
		got := calendar.Feed(nil, "fr", "Prends ton dossard", now)
		want := "BEGIN:VCALENDAR\r\n" +
			"VERSION:2.0\r\n" +
			"PRODID:-//Prends ton dossard//FR\r\n" +
			"X-WR-CALNAME:Prends ton dossard\r\n" +
			"CALSCALE:GREGORIAN\r\n" +
			"REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n" +
			"X-PUBLISHED-TTL:PT1H\r\n" +
			"END:VCALENDAR\r\n"
		if got != want {
			t.Errorf("Feed(nil) =\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("an event has its properties in the order of the brief, and an English feed says so", func(t *testing.T) {
		got := calendar.Feed([]calendar.Entry{{
			UID:         "participation-abc@prends-ton-dossard",
			Summary:     "Trail des Crêtes · Trail 42 km",
			Description: "Registered\nhttps://example.test/evenements/e1",
			Location:    "Annecy",
			URL:         "https://example.test/evenements/e1",
			Start:       "2026-06-14",
			End:         "2026-06-15",
		}}, "en", "Prends ton dossard", now)
		want := "BEGIN:VCALENDAR\r\n" +
			"VERSION:2.0\r\n" +
			"PRODID:-//Prends ton dossard//EN\r\n" +
			"X-WR-CALNAME:Prends ton dossard\r\n" +
			"CALSCALE:GREGORIAN\r\n" +
			"REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n" +
			"X-PUBLISHED-TTL:PT1H\r\n" +
			"BEGIN:VEVENT\r\n" +
			"UID:participation-abc@prends-ton-dossard\r\n" +
			"DTSTAMP:20261101T093015Z\r\n" +
			"DTSTART;VALUE=DATE:20260614\r\n" +
			"DTEND;VALUE=DATE:20260615\r\n" +
			"SUMMARY:Trail des Crêtes · Trail 42 km\r\n" +
			"DESCRIPTION:Registered\\nhttps://example.test/evenements/e1\r\n" +
			"LOCATION:Annecy\r\n" +
			"URL:https://example.test/evenements/e1\r\n" +
			"END:VEVENT\r\n" +
			"END:VCALENDAR\r\n"
		if got != want {
			t.Errorf("Feed() =\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("what is empty is left out", func(t *testing.T) {
		got := calendar.Feed([]calendar.Entry{{
			UID: "u@prends-ton-dossard", Summary: "Course", Start: "2026-06-14", End: "2026-06-15",
		}}, "fr", "Prends ton dossard", now)
		for _, property := range []string{"DESCRIPTION", "LOCATION", "URL"} {
			if strings.Contains(got, property) {
				t.Errorf("the feed has a %s that is empty:\n%q", property, got)
			}
		}
	})

	t.Run("the time of the stamp is UTC whatever the zone of the clock", func(t *testing.T) {
		paris, err := time.LoadLocation("Europe/Paris")
		if err != nil {
			t.Fatal(err)
		}
		got := calendar.Feed([]calendar.Entry{{UID: "u", Summary: "s", Start: "2026-06-14", End: "2026-06-15"}},
			"fr", "Prends ton dossard", time.Date(2026, time.November, 1, 10, 30, 15, 0, paris))
		if !strings.Contains(got, "\r\nDTSTAMP:20261101T093015Z\r\n") {
			t.Errorf("the stamp must be 20261101T093015Z (9:30:15 UTC), got:\n%q", got)
		}
	})
}

// A comma, a semicolon, a backslash or a line break that is not escaped splits
// the value, or the line: the calendar app drops the rest of the title, or the
// whole file.
func TestFeed_Escaping(t *testing.T) {
	entry := calendar.Entry{
		UID:         "participation-abc@prends-ton-dossard",
		Summary:     `Course, des; "Crêtes" \ 10 km`,
		Description: "Inscrit, confirmé\nhttps://example.test/evenements/e1;x\r\nfin",
		Location:    "Annecy, Haute-Savoie; France",
		// A URI is not text: its commas and semicolons stay as they are. It
		// cannot start a new line, though, whatever it holds.
		URL:   "https://example.test/evenements/e1?a=1,2;3\r\nATTENDEE:evil",
		Start: "2026-06-14",
		End:   "2026-06-15",
	}
	feed := calendar.Feed([]calendar.Entry{entry}, "fr", "Prends ton dossard", now)
	lines(t, feed) // CRLF at the end of every line, and nowhere else

	got := map[string]string{}
	for _, line := range unfold(feed) {
		name, value, _ := strings.Cut(line, ":")
		got[name] = value
	}
	want := map[string]string{
		"SUMMARY":     `Course\, des\; "Crêtes" \\ 10 km`,
		"DESCRIPTION": `Inscrit\, confirmé\nhttps://example.test/evenements/e1\;x\nfin`,
		"LOCATION":    `Annecy\, Haute-Savoie\; France`,
		"URL":         "https://example.test/evenements/e1?a=1,2;3ATTENDEE:evil",
	}
	for name, value := range want {
		if got[name] != value {
			t.Errorf("%s = %q, want %q", name, got[name], value)
		}
	}
	if _, injected := got["ATTENDEE"]; injected {
		t.Error("a line break in the URL started a property of its own")
	}
}

// A line is at most 75 octets, the line break not counted, and a continuation
// starts with a space, which counts. A character is never cut in two: the
// pieces are valid UTF-8 and give back the line when they are joined.
func TestFeed_Folding(t *testing.T) {
	for name, char := range map[string]string{
		"two octets":   "é",
		"three octets": "€",
		"four octets":  "🏃",
	} {
		t.Run(name, func(t *testing.T) {
			// SUMMARY: and the text make a line of about 200 octets.
			text := strings.Repeat(char, (200-len("SUMMARY:"))/len(char))
			feed := calendar.Feed([]calendar.Entry{{
				UID: "u@prends-ton-dossard", Summary: text, Start: "2026-06-14", End: "2026-06-15",
			}}, "fr", "Prends ton dossard", now)

			var pieces int
			for _, line := range lines(t, feed) {
				if len(line) > 75 {
					t.Errorf("a line of %d octets, want 75 at most: %q", len(line), line)
				}
				if !utf8.ValidString(line) {
					t.Errorf("a character is cut in two in the line %q", line)
				}
				if strings.HasPrefix(line, "SUMMARY:") || strings.HasPrefix(line, " ") {
					pieces++
				}
			}
			if pieces < 3 {
				t.Errorf("a line of about 200 octets is in %d pieces, want 3 at least", pieces)
			}

			var summary string
			for _, line := range unfold(feed) {
				if value, ok := strings.CutPrefix(line, "SUMMARY:"); ok {
					summary = value
				}
			}
			if summary != text {
				t.Errorf("the summary after unfolding is %q, want %q", summary, text)
			}
		})
	}

	t.Run("the limit is 75 octets: a line of 75 stays whole, one of 76 is folded", func(t *testing.T) {
		feedOf := func(octets int) string {
			return calendar.Feed([]calendar.Entry{{
				UID: "u", Summary: strings.Repeat("x", octets-len("SUMMARY:")), Start: "2026-06-14", End: "2026-06-15",
			}}, "fr", "Prends ton dossard", now)
		}
		whole := "SUMMARY:" + strings.Repeat("x", 75-len("SUMMARY:"))
		if got := feedOf(75); !strings.Contains(got, "\r\n"+whole+"\r\n") {
			t.Errorf("a line of 75 octets is folded:\n%q", got)
		}
		if got := feedOf(76); !strings.Contains(got, "\r\n"+whole+"\r\n x\r\n") {
			t.Errorf("a line of 76 octets must go on in a line that holds its last octet:\n%q", got)
		}
	})

	// A member can store a text that is not valid UTF-8 (a form-urlencoded
	// request is not checked), or that holds control characters. The file must
	// stay one a calendar app reads, and building it must end.
	t.Run("a text that is not valid UTF-8 or has control characters", func(t *testing.T) {
		for name, tt := range map[string]struct{ text, want string }{
			// A run of bytes that start no character has nowhere to be cut.
			"stray continuation bytes": {strings.Repeat("\x80", 200), "�"},
			"a cut character among valid ones": {
				strings.Repeat("é", 40) + "\xe2\x82" + strings.Repeat("é", 40),
				strings.Repeat("é", 40) + "�" + strings.Repeat("é", 40),
			},
			// NUL, VT, FF, ESC and DEL go, the tab stays, and a CR is not a line break.
			"control characters": {
				"a\x00b\x0bc\x0cd\x1be\x7ff\tg\rh" + strings.Repeat("x", 100),
				"abcdef\tgh" + strings.Repeat("x", 100),
			},
		} {
			t.Run(name, func(t *testing.T) {
				feed := calendar.Feed([]calendar.Entry{{
					UID: "u\x00@prends-ton-dossard", Summary: tt.text, Description: tt.text, Location: tt.text,
					URL:   "https://example.test/\x80a\x00b\x0bc\td",
					Start: "2026-06-14", End: "2026-06-15",
				}}, "fr", "Prends ton dossard", now)

				if !utf8.ValidString(feed) {
					t.Errorf("the feed is not valid UTF-8:\n%q", feed)
				}
				for _, line := range lines(t, feed) {
					if len(line) > 75 {
						t.Errorf("a line of %d octets, want 75 at most: %q", len(line), line)
					}
				}
				// Without its CRLFs, the file has no control character but the
				// tab of a text.
				if strings.ContainsFunc(strings.ReplaceAll(feed, "\r\n", ""), func(r rune) bool {
					return (r < 0x20 && r != '\t') || r == 0x7f
				}) {
					t.Errorf("the feed has a control character that is not a line break:\n%q", feed)
				}

				got := map[string]string{}
				for _, line := range unfold(feed) {
					name, value, _ := strings.Cut(line, ":")
					got[name] = value
				}
				for _, name := range []string{"SUMMARY", "DESCRIPTION", "LOCATION"} {
					if got[name] != tt.want {
						t.Errorf("%s = %q, want %q", name, got[name], tt.want)
					}
				}
				if got["UID"] != "u@prends-ton-dossard" {
					t.Errorf("UID = %q, want the control character taken out", got["UID"])
				}
				// A URI has no tab either.
				if want := "https://example.test/�abcd"; got["URL"] != want {
					t.Errorf("URL = %q, want %q", got["URL"], want)
				}
			})
		}
	})
}

// An event of one or several whole days: DTEND is the day after the last one,
// which the entry carries, and it is a date, not a date and a time.
func TestFeed_AllDay(t *testing.T) {
	feed := calendar.Feed([]calendar.Entry{
		{UID: "one-day@prends-ton-dossard", Summary: "Un jour", Start: "2026-06-14", End: "2026-06-15"},
		{UID: "two-days@prends-ton-dossard", Summary: "Deux jours", Start: "2026-06-13", End: "2026-06-15"},
		{UID: "year-end@prends-ton-dossard", Summary: "Fin d'année", Start: "2026-12-31", End: "2027-01-01"},
	}, "fr", "Prends ton dossard", now)

	var starts, ends []string
	for _, line := range lines(t, feed) {
		switch {
		case strings.HasPrefix(line, "DTSTART"):
			starts = append(starts, line)
		case strings.HasPrefix(line, "DTEND"):
			ends = append(ends, line)
		}
	}
	wantStarts := []string{"DTSTART;VALUE=DATE:20260614", "DTSTART;VALUE=DATE:20260613", "DTSTART;VALUE=DATE:20261231"}
	wantEnds := []string{"DTEND;VALUE=DATE:20260615", "DTEND;VALUE=DATE:20260615", "DTEND;VALUE=DATE:20270101"}
	if strings.Join(starts, "|") != strings.Join(wantStarts, "|") {
		t.Errorf("DTSTART lines = %q, want %q", starts, wantStarts)
	}
	if strings.Join(ends, "|") != strings.Join(wantEnds, "|") {
		t.Errorf("DTEND lines = %q, want %q", ends, wantEnds)
	}
}

func TestFeed_TimedEntriesAndAlarms(t *testing.T) {
	opening := calendar.Entry{
		UID:         "opening-e1-r1@prends-ton-dossard",
		Summary:     "Ouverture des inscriptions · Trail des Crêtes",
		Description: "https://ex.test/inscription\nhttps://ex.test/e1",
		URL:         "https://ex.test/e1",
		At:          time.Date(2027, time.January, 12, 9, 0, 0, 0, time.UTC),
		Alarms: []calendar.Alarm{
			{Trigger: "-P1D", Description: "Ouverture des inscriptions · Trail des Crêtes"},
			{Trigger: "-PT1H", Description: "Ouverture des inscriptions · Trail des Crêtes"},
		},
	}

	t.Run("a timed entry is in UTC, lasts 30 minutes and has its alarms after its properties", func(t *testing.T) {
		got := calendar.Feed([]calendar.Entry{opening}, "fr", "Prends ton dossard", now)
		want := "BEGIN:VCALENDAR\r\n" +
			"VERSION:2.0\r\n" +
			"PRODID:-//Prends ton dossard//FR\r\n" +
			"X-WR-CALNAME:Prends ton dossard\r\n" +
			"CALSCALE:GREGORIAN\r\n" +
			"REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n" +
			"X-PUBLISHED-TTL:PT1H\r\n" +
			"BEGIN:VEVENT\r\n" +
			"UID:opening-e1-r1@prends-ton-dossard\r\n" +
			"DTSTAMP:20261101T093015Z\r\n" +
			"DTSTART:20270112T090000Z\r\n" +
			"DTEND:20270112T093000Z\r\n" +
			"SUMMARY:Ouverture des inscriptions · Trail des Crêtes\r\n" +
			"DESCRIPTION:https://ex.test/inscription\\nhttps://ex.test/e1\r\n" +
			"URL:https://ex.test/e1\r\n" +
			"BEGIN:VALARM\r\n" +
			"ACTION:DISPLAY\r\n" +
			"TRIGGER:-P1D\r\n" +
			"DESCRIPTION:Ouverture des inscriptions · Trail des Crêtes\r\n" +
			"END:VALARM\r\n" +
			"BEGIN:VALARM\r\n" +
			"ACTION:DISPLAY\r\n" +
			"TRIGGER:-PT1H\r\n" +
			"DESCRIPTION:Ouverture des inscriptions · Trail des Crêtes\r\n" +
			"END:VALARM\r\n" +
			"END:VEVENT\r\n" +
			"END:VCALENDAR\r\n"
		if got != want {
			t.Errorf("Feed() =\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("the end crosses midnight", func(t *testing.T) {
		late := opening
		late.At = time.Date(2027, time.January, 12, 23, 45, 0, 0, time.UTC)
		got := calendar.Feed([]calendar.Entry{late}, "fr", "Prends ton dossard", now)
		if !strings.Contains(got, "\r\nDTSTART:20270112T234500Z\r\nDTEND:20270113T001500Z\r\n") {
			t.Errorf("the times are wrong:\n%q", got)
		}
	})

	t.Run("an entry of a whole day with an alarm keeps its dates", func(t *testing.T) {
		day := calendar.Entry{
			UID: "opening-e1-r1@prends-ton-dossard", Summary: "Ouverture", Start: "2027-01-12", End: "2027-01-13",
			Alarms: []calendar.Alarm{{Trigger: "-PT15H", Description: "Ouverture"}, {Trigger: "PT8H", Description: "Ouverture"}},
		}
		got := calendar.Feed([]calendar.Entry{day}, "fr", "Prends ton dossard", now)
		for _, want := range []string{
			"\r\nDTSTART;VALUE=DATE:20270112\r\nDTEND;VALUE=DATE:20270113\r\n",
			"\r\nTRIGGER:-PT15H\r\n", "\r\nTRIGGER:PT8H\r\n",
		} {
			if !strings.Contains(got, want) {
				t.Errorf("the feed lacks %q:\n%q", want, got)
			}
		}
	})

	t.Run("an alarm says its words escaped and folded, and cannot start a line of its own", func(t *testing.T) {
		long := opening
		long.Alarms = []calendar.Alarm{{
			Trigger:     "-PT1H\r\nATTENDEE:evil",
			Description: `Ouverture, des; inscriptions \ ` + strings.Repeat("é", 60) + "\nfin",
		}}
		feed := calendar.Feed([]calendar.Entry{long}, "fr", "Prends ton dossard", now)
		for _, line := range lines(t, feed) {
			if len(line) > 75 || strings.HasPrefix(line, "ATTENDEE") {
				t.Errorf("the line %q is too long, or is a property of its own", line)
			}
			if !utf8.ValidString(line) {
				t.Errorf("the line %q cuts a character", line)
			}
		}
		var trigger, description string
		inAlarm := false
		for _, line := range unfold(feed) {
			switch {
			case line == "BEGIN:VALARM":
				inAlarm = true
			case line == "END:VALARM":
				inAlarm = false
			case inAlarm && strings.HasPrefix(line, "TRIGGER:"):
				trigger = line
			case inAlarm && strings.HasPrefix(line, "DESCRIPTION:"):
				description = line
			}
		}
		if trigger != "TRIGGER:-PT1HATTENDEE:evil" {
			t.Errorf("trigger = %q", trigger)
		}
		if want := `DESCRIPTION:Ouverture\, des\; inscriptions \\ ` + strings.Repeat("é", 60) + `\nfin`; description != want {
			t.Errorf("description = %q, want %q", description, want)
		}
	})

	t.Run("a feed has both refresh hints", func(t *testing.T) {
		got := calendar.Feed(nil, "en", "Prends ton dossard", now)
		for _, want := range []string{"\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n", "\r\nX-PUBLISHED-TTL:PT1H\r\n"} {
			if !strings.Contains(got, want) {
				t.Errorf("the feed lacks %q", want)
			}
		}
	})
}
