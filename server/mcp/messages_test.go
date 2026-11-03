package mcp_test

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"

	"courses/server/mcp"
	"courses/server/testutil"
)

// repoFile reads a file of the repository, from the place of this file.
func repoFile(t *testing.T, parts ...string) string {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot tell where this test file is")
	}
	source, err := os.ReadFile(filepath.Join(append([]string{filepath.Dir(here), "..", ".."}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return string(source)
}

// A message is for a code that the server or PocketBase can answer.
func TestMessages_KnownCodes(t *testing.T) {
	server := map[string]bool{}
	for _, m := range regexp.MustCompile(`= "([a-z_]+)"`).FindAllStringSubmatch(repoFile(t, "server", "apperr", "codes.go"), -1) {
		server[m[1]] = true
	}
	if len(server) == 0 {
		t.Fatal("no code read in codes.go")
	}

	messages := mcp.Messages()
	if len(messages) == 0 {
		t.Fatal("no messages")
	}
	for code, text := range messages {
		if !server[code] && !strings.HasPrefix(code, "validation_") {
			t.Errorf("%s is neither a code of the server nor one of PocketBase's validation", code)
		}
		if strings.TrimSpace(text) == "" {
			t.Errorf("the message of %s is empty", code)
		}
	}
	for field, byCode := range mcp.FieldMessages() {
		for code, text := range byCode {
			if !strings.HasPrefix(code, "validation_") || strings.TrimSpace(text) == "" {
				t.Errorf("the message of %s for %s: %q", code, field, text)
			}
		}
	}
}

// The tools say what the site says: their messages are the ones of
// web/src/i18n/fr.ts, which this test reads.
func TestMessages_SameWordsAsTheSite(t *testing.T) {
	source := repoFile(t, "web", "src", "i18n", "fr.ts")
	entry := regexp.MustCompile(`(\w+):\s*"([^"]*)",`)
	block := func(name string) map[string]string {
		t.Helper()
		m := regexp.MustCompile(`(?s)\n  ` + name + `: \{(.*?)\n  \}`).FindStringSubmatch(source)
		if m == nil {
			t.Fatalf("no `%s: {...}` block in fr.ts", name)
		}
		texts := map[string]string{}
		for _, line := range entry.FindAllStringSubmatch(m[1], -1) {
			texts[line[1]] = line[2]
		}
		return texts
	}
	site := block("errors")
	format := block("format")

	for _, code := range slices.Sorted(maps.Keys(mcp.Messages())) {
		text, ok := site[code]
		if !ok {
			t.Errorf("%s has a message in the tools and none on the site", code)
			continue
		}
		if got := mcp.Messages()[code]; got != text {
			t.Errorf("%s: the tools say %q, the site %q", code, got, text)
		}
	}

	gpx := mcp.FieldMessages()["gpx"]
	for code, key := range map[string]string{
		"validation_invalid_mime_type": "gpxNotGpx",
		"validation_file_size_limit":   "gpxTooBig",
	} {
		if gpx[code] != format[key] || gpx[code] == "" {
			t.Errorf("the track, %s: the tools say %q, the site (format.%s) %q", code, gpx[code], key, format[key])
		}
	}
}

func TestDescribe(t *testing.T) {
	app := testutil.NewApp(t)
	app.Settings().Logs.MaxDays = 5 // the logs are off in a test application
	refused := func(status int, method string) *mcp.APIError {
		return &mcp.APIError{Status: status, Method: method, Request: -1}
	}
	withFields := func(fields map[string]string) *mcp.APIError {
		e := refused(http.StatusBadRequest, http.MethodPost)
		e.Fields = fields
		return e
	}
	withCode := func(status int, code string) *mcp.APIError {
		e := refused(status, http.MethodPost)
		e.Code = code
		return e
	}
	inBatch := func(e *mcp.APIError, request int) *mcp.APIError {
		e.Request = request
		return e
	}
	format := func(request int) string {
		return fmt.Sprintf("Épreuve %d (« Trail 15 km »)", request)
	}

	for _, row := range []struct {
		name    string
		err     error
		subject func(int) string
		want    string
	}{
		{
			"a field", withFields(map[string]string{"date": "format_date_out_of_range"}), nil,
			"date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range)",
		},
		{
			// The example of spec § 6.12.
			"a field of a request of a batch", inBatch(withFields(map[string]string{"date": "format_date_out_of_range"}), 2), format,
			"Épreuve 2 (« Trail 15 km »), date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range)",
		},
		{
			"a batch without a subject", inBatch(withFields(map[string]string{"date": "format_date_out_of_range"}), 2), nil,
			"date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range)",
		},
		{
			"two fields", withFields(map[string]string{"start_date": "validation_required", "name": "validation_required"}), nil,
			"nom : ce champ est obligatoire. (validation_required) ; date de début : ce champ est obligatoire. (validation_required)",
		},
		{
			"a field without a French name", withFields(map[string]string{"colour": "validation_required"}), nil,
			"colour : ce champ est obligatoire. (validation_required)",
		},
		{
			"a code of a field without a message", withFields(map[string]string{"distance_km": "validation_min_number_constraint"}), nil,
			"distance : le site a refusé (code validation_min_number_constraint).",
		},
		{
			"the type of a track", withFields(map[string]string{"gpx": "validation_invalid_mime_type"}), nil,
			"trace : ce fichier n'est pas une trace GPX. (validation_invalid_mime_type)",
		},
		{
			"the size of a track", withFields(map[string]string{"gpx": "validation_file_size_limit"}), nil,
			"trace : la trace est trop lourde : 10 Mo maximum. (validation_file_size_limit)",
		},
		{
			"the type of a photo", withFields(map[string]string{"avatar": "validation_invalid_mime_type"}), nil,
			"photo : ce type d'image n'est pas accepté : JPEG, PNG ou WebP. (validation_invalid_mime_type)",
		},
		{
			"a code", withCode(http.StatusBadRequest, "last_admin"), nil,
			"Il doit toujours rester au moins un admin. (last_admin)",
		},
		{
			"a code of a request of a batch", inBatch(withCode(http.StatusBadRequest, "price_invalid"), 0), format,
			"Épreuve 0 (« Trail 15 km »), le prix se donne au centime près. (price_invalid)",
		},
		{
			"a code without a message", withCode(http.StatusBadRequest, "mystery_code"), nil,
			"Le site a refusé (code mystery_code).",
		},
		{
			// The rule of a creation refuses with a bare 400.
			"a bare 400", refused(http.StatusBadRequest, http.MethodPost), nil,
			"Tu n'as pas le droit de faire ça.",
		},
		{
			// A read that PocketBase finds malformed (a filter, a sort, an expand) is a
			// fault of the tool, not a right that the person lacks.
			"a bare 400 on a read", refused(http.StatusBadRequest, http.MethodGet), nil,
			"Le site a rencontré une erreur. Réessaie dans un instant.",
		},
		{"a 403", refused(http.StatusForbidden, http.MethodPost), nil, "Tu n'as pas le droit de faire ça."},
		{"a 404 on a read", refused(http.StatusNotFound, http.MethodGet), nil, "Introuvable : il a peut-être été supprimé."},
		{"a 404 on an update", refused(http.StatusNotFound, http.MethodPatch), nil, "Introuvable, ou ce n'est pas à toi de le modifier."},
		{"a 404 on a deletion", refused(http.StatusNotFound, http.MethodDelete), nil, "Introuvable, ou ce n'est pas à toi de le modifier."},
		{
			"a 404 with its code", withCode(http.StatusNotFound, "not_found"), nil,
			"Introuvable, ou ce n'est pas à toi de le modifier.",
		},
		{
			// A read that stopped at its bound: trying again is no use, which the message
			// says, with the bound of that read.
			"a read that hit the bound", mcp.TooMany("participations", 5000), nil,
			"Il y a trop d'enregistrements pour les lire d'un coup (plus de 5000) : réessayer n'y changera rien. " +
				"Précise la demande si l'outil le permet (une autre année pour get_stats), sinon c'est une limite du serveur MCP.",
		},
		{
			"a read that hit the bound, wrapped", fmt.Errorf("reading the events: %w", mcp.TooMany("events", 2000)), nil,
			"Il y a trop d'enregistrements pour les lire d'un coup (plus de 2000) : réessayer n'y changera rien. " +
				"Précise la demande si l'outil le permet (une autre année pour get_stats), sinon c'est une limite du serveur MCP.",
		},
		{"a 429", refused(http.StatusTooManyRequests, http.MethodGet), nil, "Trop de demandes d'un coup : attends une minute avant de réessayer."},
		{"a 500", refused(http.StatusInternalServerError, http.MethodGet), nil, "Le site a rencontré une erreur. Réessaie dans un instant."},
		{"another error", errors.New("the router is gone"), nil, "Le site a rencontré une erreur. Réessaie dans un instant."},
	} {
		t.Run(row.name, func(t *testing.T) {
			got := mcp.Describe(app, row.err, row.subject)
			if got == nil || got.Error() != row.want {
				t.Errorf("got  %v\nwant %s", got, row.want)
			}
		})
	}

	// What the generic message hides is in the log of the server.
	logged := map[string]string{}
	var bounds []string
	for _, entry := range testutil.RequestLogs(t, app, 5) {
		text, _ := entry.Data["error"].(string)
		logged[entry.Message] = text
		if entry.Message == "mcp: a read hit the bound" {
			bounds = append(bounds, text)
		}
	}
	if got := logged["mcp: a read was refused as malformed"]; !strings.Contains(got, "400") {
		t.Errorf("the bare 400 of a read is logged as %q", got)
	}
	// The bound that a read hit, and the collection, are in the log.
	for _, want := range []string{"participations, more than 5000", "events, more than 2000"} {
		if !slices.ContainsFunc(bounds, func(logged string) bool { return strings.Contains(logged, want) }) {
			t.Errorf("the bounds that were logged are %q, want one with %q", bounds, want)
		}
	}
	if got := logged["mcp: a tool failed"]; got != "the router is gone" {
		t.Errorf("the error of another kind is logged as %q", got)
	}
	if got := logged["mcp: the site failed a request of a tool"]; !strings.Contains(got, "500") {
		t.Errorf("the 500 is logged as %q", got)
	}
}
