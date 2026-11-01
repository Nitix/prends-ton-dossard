package calendar

import (
	"strings"
	"testing"
)

// Feed cleans every text before it folds it, so the line of a feed is always
// valid UTF-8. fold does not rely on that: on a line with no place to cut a
// character (a run of bytes that start none), it cuts at the limit, as it must
// always move forward. Without it, such a line is never done.
func TestFold_AlwaysMovesForward(t *testing.T) {
	line := "SUMMARY:" + strings.Repeat("\x80", 300)

	folded := fold(line)

	for _, piece := range strings.Split(folded, "\r\n") {
		if len(piece) > maxLineOctets {
			t.Errorf("a line of %d octets, want %d at most", len(piece), maxLineOctets)
		}
	}
	if got := strings.ReplaceAll(folded, "\r\n ", ""); got != line {
		t.Errorf("the line after unfolding is %q, want %q", got, line)
	}
}
