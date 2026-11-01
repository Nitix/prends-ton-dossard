package migrations_test

import (
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// PocketBase runs the migrations in the order of their file names, compared as
// strings (core/migrations_list.go), and records the ones it has applied by
// file name, so a deployed file is never renamed. The intended order is the
// number, then the letters after it: 1, 2, ..., 9, 9a, 9b. Two digits do not
// follow it: "10_x.go" sorts before "1_collections.go", because '0' is before
// '_', and it would run first on a database that is created from scratch (a
// new install, the tests, the seed). The rule is in doc.go.

// checkMigrationNames returns what is wrong with the file names of the
// migrations, given in the order PocketBase runs them: a name that does not
// follow <number><letters>_<name>.go, or one that runs before one it should
// follow.
func checkMigrationNames(files []string) []string {
	var problems []string
	var previous *migrationName
	for _, file := range files {
		name, ok := parseMigrationName(file)
		if !ok {
			problems = append(problems, file+": the name must be <number><lowercase letters>_<name>.go")
			continue
		}
		if previous != nil && !previous.before(name) {
			problems = append(problems, file+": runs after "+previous.file+", but is not after it in the intended order (number, then letters)")
		}
		previous = &name
	}
	return problems
}

// migrationName is a file name split into the parts that decide its place.
type migrationName struct {
	file    string
	number  int
	letters string
}

// parseMigrationName splits "9a_runner_avatar.go" into 9 and "a".
func parseMigrationName(file string) (migrationName, bool) {
	rest, ok := strings.CutSuffix(file, ".go")
	if !ok {
		return migrationName{}, false
	}
	prefix, name, ok := strings.Cut(rest, "_")
	if !ok || name == "" {
		return migrationName{}, false
	}
	digits := strings.TrimRight(prefix, "abcdefghijklmnopqrstuvwxyz")
	letters := prefix[len(digits):]
	if digits == "" || strings.TrimLeft(digits, "0123456789") != "" || digits[0] == '0' {
		return migrationName{}, false
	}
	number := 0
	for _, digit := range digits {
		number = number*10 + int(digit-'0')
	}
	return migrationName{file: file, number: number, letters: letters}, true
}

// before reports whether the migration n is to run strictly before m.
func (n migrationName) before(m migrationName) bool {
	if n.number != m.number {
		return n.number < m.number
	}
	return n.letters < m.letters
}

// A misnamed file fails here, before a deploy, instead of running out of order
// on a fresh database.
func TestMigrationNames_FollowTheIntendedOrder(t *testing.T) {
	var files []string
	for _, m := range core.AppMigrations.Items() {
		files = append(files, m.File)
	}
	if len(files) == 0 {
		t.Fatal("no migration is registered")
	}
	for _, problem := range checkMigrationNames(files) {
		t.Error(problem)
	}
}

// What the guard flags, on lists of names sorted the way PocketBase sorts them.
func TestCheckMigrationNames(t *testing.T) {
	// sorted registers the names in a PocketBase list, which sorts them as it
	// does when it runs them.
	sorted := func(names ...string) []string {
		var list core.MigrationsList
		for _, name := range names {
			list.Register(nil, nil, name)
		}
		var files []string
		for _, m := range list.Items() {
			files = append(files, m.File)
		}
		return files
	}

	tests := []struct {
		name  string
		files []string
		want  int // the number of problems
	}{
		{"the migrations of the application", sorted(
			"1_collections.go", "2_seed_race_types.go", "3_settings.go", "4_rules.go", "5_participation_rules.go",
			"6_trusted_proxy.go", "7_users_email_nocase.go", "8_participation_event.go", "9_runner_avatar.go",
			"9a_registration.go", "9b_supporter.go", "9c_comments.go",
		), 0},
		{"a letter after 9 follows 9", sorted("1_a.go", "9_b.go", "9a_c.go", "9b_d.go"), 0},
		{"two letters follow their first one", sorted("9_a.go", "9a_b.go", "9aa_c.go", "9b_d.go", "9z_e.go", "9za_f.go"), 0},
		{"two digits run before the first migration", sorted("1_a.go", "9_b.go", "10_c.go"), 1},
		{"two digits are flagged even when they come last", sorted("2_a.go", "3_b.go", "20_c.go"), 1},
		{"a capital letter runs first", sorted("1_a.go", "9_b.go", "9A_c.go"), 1},
		{"a name without a number", sorted("1_a.go", "init.go"), 1},
		{"a name without a description", sorted("1_a.go", "2_.go"), 1},
		{"a number that starts with 0", sorted("1_a.go", "02_b.go"), 1},
		{"a duplicate", sorted("1_a.go", "1_a.go"), 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkMigrationNames(tt.files)
			if len(got) != tt.want {
				t.Errorf("checkMigrationNames(%q) = %q, want %d problems", tt.files, got, tt.want)
			}
		})
	}
}
