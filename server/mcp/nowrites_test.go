package mcp_test

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The package never writes itself (spec § 5.3): every action is a request to
// the API of the site, which applies its rules and hooks. A direct write would
// skip them, and a token could do more than its owner.
func TestPackage_NoDirectWrites(t *testing.T) {
	write := regexp.MustCompile(`\.(Save|SaveNoValidate|Delete|DeleteWithContext|RunInTransaction|DB|NonconcurrentDB|AuxDB)\(`)

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	read := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		source, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		read++
		for i, line := range strings.Split(string(source), "\n") {
			if m := write.FindString(line); m != "" {
				t.Errorf("%s:%d writes itself (%s): %s", name, i+1, m, strings.TrimSpace(line))
			}
		}
	}
	// Without this, the test would pass in an empty directory.
	if read < 5 {
		t.Errorf("%d source files read, want the package's", read)
	}
}
