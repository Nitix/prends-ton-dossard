package mcp_test

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// write finds a write of core.App, or a way to one: every Save, Delete and
// RunInTransaction, with or without a context, of the main or the auxiliary
// database; a handle on a database; the truncations, imports, vacuums and
// backups. Nothing of the package ever needs one.
var write = regexp.MustCompile(`\.(Aux\w*|Save\w*|Delete\w*|RunInTransaction\w*|\w*DB|Truncate\w*|Import\w*|Vacuum\w*|CreateBackup|RestoreBackup)\(`)

// standard are the functions of the standard library that the pattern would
// find: they write no database.
var standard = regexp.MustCompile(`\b(slices|maps)\.Delete\w*\(`)

// writes is the write that line makes, or "".
func writes(line string) string {
	return write.FindString(standard.ReplaceAllString(line, ""))
}

// The package never writes itself (spec § 5.3): every action is a request to
// the API of the site, which applies its rules and hooks. A direct write would
// skip them, and a token could do more than its owner.
func TestPackage_NoDirectWrites(t *testing.T) {
	// The pattern itself: what it must find, and what it must not.
	for _, line := range []string{
		"app.Save(record)", "app.SaveNoValidate(record)", "app.SaveWithContext(ctx, record)", "app.SaveNoValidateWithContext(ctx, record)",
		"app.Delete(record)", "app.DeleteWithContext(ctx, record)", "app.DeleteTable(name)", "app.DeleteAllFilesByRecord(record)",
		"app.AuxSave(log)", "app.AuxDelete(log)", "app.AuxRunInTransaction(f)", "app.AuxDB()", "app.AuxNonconcurrentDB()",
		"app.RunInTransaction(f)", "app.DB()", "app.ConcurrentDB()", "app.NonconcurrentDB()", "e.App.AuxConcurrentDB()",
		"app.TruncateCollection(c)", "app.ImportCollections(list, false)", "app.ImportCollectionsByMarshaledJSON(b, false)",
		"app.Vacuum()", "app.AuxVacuum()", "app.CreateBackup(ctx, name)", "app.RestoreBackup(ctx, name)",
	} {
		if writes(line) == "" {
			t.Errorf("the pattern does not find %q", line)
		}
	}
	for _, line := range []string{
		"http.MethodDelete", `req.Header.Set("A", "b")`, "h.Add(name, value)", "delete(l.buckets, id)",
		"t.inner.send(ctx, method, path, body, out)", "slices.DeleteFunc(list, f)", "maps.DeleteFunc(m, f)",
	} {
		if m := writes(line); m != "" {
			t.Errorf("the pattern finds %q in %q", m, line)
		}
	}

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
			if m := writes(line); m != "" {
				t.Errorf("%s:%d writes itself (%s): %s", name, i+1, m, strings.TrimSpace(line))
			}
		}
	}
	// Without this, the test would pass in an empty directory.
	if read < 5 {
		t.Errorf("%d source files read, want the package's", read)
	}
}
