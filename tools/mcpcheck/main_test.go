package main

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/testutil"
)

// production is the address of the real site: mcpcheck may only read there, and
// no test contacts it (the options are only parsed).
const production = "https://prends-ton-dossard.ketra.fr/mcp"

func TestParseOptions_Defaults(t *testing.T) {
	var stderr bytes.Buffer
	got, err := parseOptions(nil, &stderr)
	if err != nil {
		t.Fatalf("parseOptions(nil) = %v", err)
	}
	if want := (options{URL: "http://127.0.0.1:8090/mcp"}); got != want {
		t.Errorf("the defaults are %+v, not %+v", got, want)
	}
}

func TestParseOptions_Flags(t *testing.T) {
	var stderr bytes.Buffer
	got, err := parseOptions([]string{"-url", "http://localhost:5173/mcp", "-login", "alice@example.test", "-write"}, &stderr)
	if err != nil {
		t.Fatalf("parseOptions = %v", err)
	}
	want := options{URL: "http://localhost:5173/mcp", Login: "alice@example.test", Write: true}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestParseOptions_Refused(t *testing.T) {
	for name, args := range map[string][]string{
		"a flag that does not exist": {"-verbose"},
		"a value without its flag":   {"alice@example.test"},
		"a url that is not one":      {"-url", "127.0.0.1:8090/mcp"},
		"a url with no host":         {"-url", "http:///mcp"},
		"a scheme that is not http":  {"-url", "ftp://127.0.0.1/mcp"},
		"a url with credentials":     {"-url", "http://alice:secret@127.0.0.1:8090/mcp"},
	} {
		t.Run(name, func(t *testing.T) {
			var stderr bytes.Buffer
			if got, err := parseOptions(args, &stderr); err == nil {
				t.Errorf("parseOptions(%q) = %+v, want an error", args, got)
			}
		})
	}
}

func TestParseOptions_Help(t *testing.T) {
	var stderr bytes.Buffer
	if _, err := parseOptions([]string{"-h"}, &stderr); err != flag.ErrHelp {
		t.Errorf("-h gave %v, want flag.ErrHelp", err)
	}
	for _, name := range []string{"-url", "-login", "-write"} {
		if !strings.Contains(stderr.String(), name) {
			t.Errorf("the usage does not say %s:\n%s", name, stderr.String())
		}
	}
}

func TestOptions_OnlyALocalServerIsWrittenTo(t *testing.T) {
	local := []string{
		"http://127.0.0.1:8090/mcp",
		"http://localhost:5173/mcp",
		"http://LOCALHOST:5173/mcp",
		"http://[::1]:8090/mcp",
		"http://127.0.0.2:8090/mcp",
	}
	elsewhere := []string{
		production,
		"http://prends-ton-dossard.ketra.fr/mcp",
		"http://localhost.ketra.fr/mcp",
		"http://127.0.0.1.nip.io/mcp",
		"http://0.0.0.0:8090/mcp",
		"http://192.168.1.20:8090/mcp",
		"https://example.test/mcp?host=localhost",
		"https://example.test/localhost/mcp",
	}

	for _, address := range local {
		for _, args := range [][]string{{"-write"}, {"-login", "alice@example.test"}, {"-login", "alice@example.test", "-write"}} {
			var stderr bytes.Buffer
			if _, err := parseOptions(append([]string{"-url", address}, args...), &stderr); err != nil {
				t.Errorf("%v on %s is refused: %v", args, address, err)
			}
		}
	}

	for _, address := range elsewhere {
		// Reading is allowed anywhere: the token of the user, in PTD_MCP_TOKEN.
		var stderr bytes.Buffer
		if _, err := parseOptions([]string{"-url", address}, &stderr); err != nil {
			t.Errorf("reading %s is refused: %v", address, err)
		}
		for _, args := range [][]string{{"-write"}, {"-login", "alice@example.test"}, {"-login", "alice@example.test", "-write"}} {
			got, err := parseOptions(append([]string{"-url", address}, args...), &stderr)
			if err == nil {
				t.Errorf("%v on %s is accepted: %+v", args, address, got)
			}
		}
	}
}

func TestOptions_TheRefusalSaysWhy(t *testing.T) {
	var stderr bytes.Buffer
	_, err := parseOptions([]string{"-url", production, "-write"}, &stderr)
	if err == nil {
		t.Fatal("-write on the production address is accepted")
	}
	for _, want := range []string{"-write", "prends-ton-dossard.ketra.fr", "local"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal %q does not say %q", err, want)
		}
	}
	_, err = parseOptions([]string{"-url", production, "-login", "alice@example.test"}, &stderr)
	if err == nil || !strings.Contains(err.Error(), "-login") {
		t.Errorf("-login on the production address: %v, want a refusal that names -login", err)
	}
}

// The files that the check sends are the ones of the generators of the tests of
// the server, so that they can be made again: MCPCHECK_UPDATE=1 go test
// ./tools/mcpcheck/ writes them.
func TestTestdata_AreWhatTheGeneratorsMake(t *testing.T) {
	files := map[string][]byte{
		"testdata/track.gpx": testutil.GPX(t, 40),
		"testdata/photo.png": testutil.PNG(t, 16, 16),
	}
	for path, want := range files {
		if os.Getenv("MCPCHECK_UPDATE") != "" {
			if err := os.WriteFile(path, want, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v (MCPCHECK_UPDATE=1 makes it)", path, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s is not what the generator makes (MCPCHECK_UPDATE=1 makes it again)", path)
		}
		if len(got) > 4096 {
			t.Errorf("%s is %d bytes: a small file is enough", path, len(got))
		}
	}
	// The program embeds the files it was built with: after an update, the next build has them.
	if os.Getenv("MCPCHECK_UPDATE") == "" && (!bytes.Equal(trackGPX, files["testdata/track.gpx"]) || !bytes.Equal(photoPNG, files["testdata/photo.png"])) {
		t.Error("the files that the program embeds are not the ones of testdata")
	}
}

func TestReporter_NeverPrintsASecret(t *testing.T) {
	const (
		mcpToken = "ptd_aaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		session  = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InRlc3QifQ.c2lnbmF0dXJl"
		custom   = "un secret que rien ne reconnaît"
	)
	var out bytes.Buffer
	r := &reporter{out: &out}
	r.add(mcpToken)
	r.add(session)
	r.add(custom)

	r.ok("whoami", "Bearer "+mcpToken)
	r.fail("remove_participation", `rappelle l'outil avec confirmation: "cfm_ABCDEFGHIJKLMNOPQRSTUVWXYZ" (valable 10 minutes)`)
	r.ok("start_upload", `curl -H "X-Upload-Secret: ptu_ABCDEFGHIJKLMNOPQRSTUVWXYZ" https://127.0.0.1:8090/api/app/mcp-uploads/abc`)
	r.ok("admin_create_link", "http://127.0.0.1:8090/invitation#abcdefghijklmnop expire le 2026-11-10")
	r.ok("calendar_link", "http://127.0.0.1:8090/api/app/calendar/abcdefghijklmnop.ics")
	r.ok("session", session+" et "+custom)
	r.fail("mcp", "Authorization: Bearer "+mcpToken+"\nsur deux lignes")

	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(lines) != 7 {
		t.Fatalf("%d lines for 7 steps (a message on two lines is one line):\n%s", len(lines), out.String())
	}
	for _, forbidden := range []string{"ptd_", "cfm_", "ptu_", "invitation#", ".ics", "Bearer ", "eyJ", mcpToken, session, custom} {
		if strings.Contains(out.String(), forbidden) {
			t.Errorf("the output holds %q:\n%s", forbidden, out.String())
		}
	}
	if !strings.HasPrefix(lines[0], "ok   whoami — ") || !strings.HasPrefix(lines[1], "FAIL remove_participation — ") {
		t.Errorf("a line is « ok   <step> — <what> » or « FAIL <step> — <why> »:\n%s\n%s", lines[0], lines[1])
	}
}

// ---------------------------------------------------------------------------
// A fake site, to run the check against
//
// It speaks the protocol with the official SDK (a stateless server that answers
// in JSON, as the real one does) and keeps just enough of the site to answer the
// steps: what is created is counted, a risky call is answered a confirmation that
// a token of its own then takes, once. It plants secrets where the real site puts
// them (a confirmation token in its message, the secret of an upload, the address
// of an invitation and of a calendar), so that the tests can look for them in the
// lines of the run.

const fakePassword = "courses-dev-password"

// fakeToday is the day in Paris, as whoami says it.
func fakeToday() string { return time.Now().In(paris).Format(time.DateOnly) }

// The tools of each role, as the real server names them.
var (
	fakeMemberTools = []string{
		"whoami", "home", "list_runners", "get_runner", "get_stats", "list_race_types", "search_events", "get_event",
		"create_event", "update_event", "delete_event", "add_format", "update_format", "delete_format",
		"add_participation", "update_participation", "remove_participation", "set_result",
		"add_comment", "update_comment", "delete_comment",
		"add_offer", "update_offer", "delete_offer", "offer_place",
		"start_upload", "set_photo", "set_track",
		"rename_runner", "passkeys", "calendar_link", "mcp_tokens", "reminders", "get_weather",
	}
	fakeAdminTools = []string{
		"admin_list_members", "admin_create_runner", "admin_delete_runner", "admin_create_link", "admin_revoke_link",
		"admin_set_role", "admin_set_disabled", "admin_create_race_type", "admin_update_race_type", "admin_delete_race_type",
		"admin_merge",
	}
)

type fakeSite struct {
	t      *testing.T
	admin  bool
	server *httptest.Server

	// What the site hands out.
	session, mcpToken, uploadSecret string

	// leak makes the answers say what a secret looks like, where a person's text
	// could (a name, a summary): what the lines must not repeat.
	leak bool
	// refuse makes the server answer 401 to every call.
	refuse bool
	// asLocalhost is a site that knows itself as localhost (its APP_URL) while it is
	// reached by 127.0.0.1; elsewhere is one whose APP_URL is not this server.
	asLocalhost, elsewhere bool

	mu         sync.Mutex
	tokens     map[string]string // the tokens that work: secret -> id
	made       int               // the tokens made through the route
	confirms   map[string]string // the confirmations that wait: token -> the call
	issued     []string          // every confirmation token handed out
	used       map[string]bool
	counts     map[string]int    // how many races have a name
	names      map[string]string // race id -> name
	seq        int
	calls      []string
	uploaded   []byte
	slotOpen   bool
	hasPhoto   bool
	formats    []*fakeFormat
	end        string
	eventName  string
	eventID    string
	start      string
	deleted    map[string]bool
	revokedIDs []string
}

type fakeFormat struct {
	id, date string
	distance float64
	joined   bool
}

func newFakeSite(t *testing.T, admin bool) *fakeSite {
	f := &fakeSite{
		t: t, admin: admin,
		session:      "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImZha2UifQ.ZmFrZS1zaWduYXR1cmU",
		mcpToken:     "ptd_fakefakefakefak_" + strings.Repeat("A", 43),
		uploadSecret: "ptu_" + strings.Repeat("U", 26),
		tokens:       map[string]string{},
		confirms:     map[string]string{},
		used:         map[string]bool{},
		counts:       map[string]int{},
		names:        map[string]string{},
		deleted:      map[string]bool{},
	}
	f.server = httptest.NewServer(f.routes())
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeSite) url() string { return f.server.URL + "/mcp" }

// valid says whether a token of the MCP works.
func (f *fakeSite) valid(token string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.tokens[token]
	return ok && !f.refuse
}

func (f *fakeSite) routes() http.Handler {
	mux := http.NewServeMux()
	member, admin := f.mcpServer(false), f.mcpServer(true)
	handler := mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server {
		if f.admin {
			return admin
		}
		return member
	}, &mcpsdk.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !f.valid(token) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="prends-ton-dossard"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r)
	})

	mux.HandleFunc("POST /api/collections/users/auth-with-password", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Identity, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Password != fakePassword || body.Identity == "" {
			http.Error(w, `{"message":"Failed to authenticate."}`, http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"token": f.session})
	})
	mux.HandleFunc("POST /api/app/mcp-tokens", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != f.session {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.made++
		token, id := f.mcpToken, "tok00000000001"
		if f.made > 1 {
			token, id = fmt.Sprintf("ptd_%015d_%s", f.made, strings.Repeat("B", 43)), fmt.Sprintf("tok%012d", f.made)
		}
		f.tokens[token] = id
		json.NewEncoder(w).Encode(map[string]any{"id": id, "name": "mcpcheck", "token": token, "url": f.server.URL + "/mcp"})
	})
	mux.HandleFunc("DELETE /api/app/mcp-tokens/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != f.session {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !f.revoke(r.PathValue("id")) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("PUT /api/app/mcp-uploads/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.slotOpen || r.Header.Get("X-Upload-Secret") != f.uploadSecret {
			http.Error(w, "upload_invalid", http.StatusBadRequest)
			return
		}
		f.uploaded, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /files/track.gpx", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Write(f.uploaded)
	})
	return mux
}

// revoke removes a token of the MCP by its id.
func (f *fakeSite) revoke(id string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for token, tokenID := range f.tokens {
		if tokenID == id {
			delete(f.tokens, token)
			f.revokedIDs = append(f.revokedIDs, id)
			return true
		}
	}
	return false
}

func (f *fakeSite) mcpServer(admin bool) *mcpsdk.Server {
	server := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "prends-ton-dossard", Version: "1.0.0"},
		&mcpsdk.ServerOptions{Instructions: "Prends ton dossard est le site privé d'un groupe d'amis."})
	names := slices.Clone(fakeMemberTools)
	if admin {
		names = append(names, fakeAdminTools...)
	}
	for _, name := range names {
		server.AddTool(&mcpsdk.Tool{Name: name, Description: "Un outil de test.", InputSchema: map[string]any{"type": "object"}},
			func(_ context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
				var args map[string]any
				if len(req.Params.Arguments) > 0 {
					if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
						return nil, err
					}
				}
				answer, problem := f.handle(req.Params.Name, args)
				if problem != "" {
					return &mcpsdk.CallToolResult{IsError: true, Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: problem}}}, nil
				}
				text, _ := json.Marshal(answer)
				return &mcpsdk.CallToolResult{StructuredContent: answer, Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: string(text)}}}, nil
			})
	}
	return server
}

// obj is a JSON object.
type obj = map[string]any

func (f *fakeSite) id(prefix string) string {
	f.seq++
	return fmt.Sprintf("%s%012d", prefix, f.seq)
}

func (f *fakeSite) me() string {
	if f.admin {
		return "Admin"
	}
	return "Alice"
}

func (f *fakeSite) person(name string) obj {
	return obj{"id": "run" + fmt.Sprintf("%012d", len(name)), "name": name}
}

// text is what a person's text can hold: a secret, when the site leaks one.
func (f *fakeSite) text(s string) string {
	if f.leak {
		return s + " " + f.mcpToken + " cfm_LEAKEDLEAKEDLEAKED http://127.0.0.1/invitation#LEAKED"
	}
	return s
}

// guard is the confirmation of the site: a risky call without a valid token is
// answered one, and written to nothing; a valid token is taken, once.
func (f *fakeSite) guard(tool string, args obj, risky bool, details ...string) (proceed bool, answer obj) {
	given, _ := args["confirmation"].(string)
	call := obj{}
	for k, v := range args {
		if k != "confirmation" {
			call[k] = v
		}
	}
	key, _ := json.Marshal([]any{tool, call})

	notice := ""
	switch {
	case given != "" && f.used[given]:
		notice = "Confirmation refusée : elle a déjà servi. "
	case given != "" && string(key) != f.confirms[given]:
		notice = "Confirmation refusée : elle est inconnue ou ne correspond pas à cette demande. "
	case given != "":
		f.used[given] = true
		return true, nil
	case !risky:
		return true, nil
	}
	token := "cfm_" + strings.ToUpper(fmt.Sprintf("%026x", len(f.issued)+1))
	f.issued = append(f.issued, token)
	f.confirms[token] = string(key)
	return false, obj{
		"done":    false,
		"summary": notice + "Rien n'a été fait : la demande attend l'accord de la personne (voir confirmation).",
		"confirmation": obj{
			"token":      token,
			"expires_at": time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
			"message":    "Rien n'a été fait. Ceci serait perdu. Rappelle " + tool + " avec les mêmes arguments et confirmation: \"" + token + "\" (valable 10 minutes, une seule fois).",
			"details":    append([]string{}, details...),
		},
	}
}

func (f *fakeSite) eventDetail() obj {
	formats := []obj{}
	for i, format := range f.formats {
		day := cmp.Or(format.date, f.start)
		participants := []obj{}
		if format.joined {
			participants = append(participants, obj{"runner": f.person(f.me()), "status": "registered", "confirmed": true})
		}
		detail := obj{"id": format.id, "title": fmt.Sprintf("Trail %d", i), "day": day, "distance_km": format.distance, "participants": participants}
		if format.date != "" {
			detail["date"] = format.date
		}
		formats = append(formats, detail)
	}
	return obj{"id": f.eventID, "name": f.eventName, "start_date": f.start, "end_date": f.end, "formats": formats}
}

func (f *fakeSite) handle(tool string, args obj) (obj, string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, tool)
	me := f.me()
	done := func(summary string, more obj) (obj, string) {
		answer := obj{"done": true, "summary": summary}
		maps.Copy(answer, more)
		return answer, ""
	}
	str := func(key string) string { s, _ := args[key].(string); return s }

	switch tool {
	case "whoami":
		role := "member"
		if f.admin {
			role = "admin"
		}
		return obj{"runner": obj{"id": "run000000000001", "name": me, "url": f.base() + "/coureurs/run000000000001"},
			"role": role, "token": obj{"id": "tok00000000001", "name": "mcpcheck"}, "site": f.base(), "today": fakeToday()}, ""
	case "home":
		return obj{"to_confirm": []any{}, "registrations_to_do": []any{}, "results_to_enter": []any{},
			"my_upcoming": []any{obj{"participation_id": "p"}}, "group_soon": []any{}, "latest_comments": []any{}}, ""
	case "list_race_types":
		return obj{"race_types": []any{
			obj{"id": "typ000000000001", "label": f.text("Route"), "measures": []string{"distance"}},
			obj{"id": "typ000000000002", "label": "Trail", "measures": []string{"distance", "elevation"}},
		}}, ""
	case "search_events":
		if query := str("query"); query != "" {
			events := []any{}
			for name, n := range f.counts {
				if strings.Contains(name, query) {
					for range n {
						events = append(events, obj{"id": f.id("evt"), "name": name, "start_date": f.start, "url": f.base() + "/evenements/x"})
					}
				}
			}
			return obj{"events": events, "count": len(events), "truncated": false}, ""
		}
		return obj{"events": []any{
			obj{"id": "evt000000000901", "name": f.text("Trail des Crêtes"), "start_date": "2026-11-20", "url": f.base() + "/evenements/evt000000000901"},
			obj{"id": "evt000000000902", "name": "10 km de la Ville", "start_date": "2026-12-01", "url": f.base() + "/evenements/evt000000000902"},
		}, "count": 2, "truncated": false}, ""
	case "get_stats":
		return obj{"year": 2026, "runners": []any{}}, ""

	case "create_event":
		name := str("name")
		proceed, answer := f.guard(tool, args, f.counts[name] > 0, "« "+name+" » ("+str("start_date")+", Annecy, 0 participant, id evt000000000000)")
		if !proceed {
			return answer, ""
		}
		if f.leak && name == raceName {
			return obj{"done": false, "summary": f.text("Le site a refusé la course")}, ""
		}
		f.eventID, f.eventName, f.start = f.id("evt"), name, str("start_date")
		f.end = f.start
		f.counts[name]++
		f.names[f.eventID] = name
		f.formats = nil
		formats, _ := args["formats"].([]any)
		for _, raw := range formats {
			format, _ := raw.(obj)
			date, _ := format["date"].(string)
			f.formats = append(f.formats, &fakeFormat{id: f.id("fmt"), date: date, distance: 10})
			if date != "" {
				f.end = date
			}
		}
		if join, ok := args["join"].(obj); ok {
			if i, ok := join["format_index"].(float64); ok && int(i) < len(f.formats) {
				f.formats[int(i)].joined = true
			}
		}
		return done("La course est créée.", f.eventDetail())
	case "update_event":
		if name := str("name"); name != "" {
			f.counts[f.eventName]--
			f.eventName = name
			f.names[f.eventID] = name
			f.counts[name]++
		}
		return done("La course est modifiée.", f.eventDetail())
	case "get_event":
		if f.deleted[str("event_id")] || str("event_id") != f.eventID {
			return nil, "Introuvable : cette course n'existe pas."
		}
		return f.eventDetail(), ""
	case "delete_event":
		proceed, answer := f.guard(tool, args, true, "Les 2 épreuves partent avec elle.")
		if !proceed {
			return answer, ""
		}
		id := str("event_id")
		name := f.names[id]
		f.counts[name]--
		f.deleted[id] = true
		return done("La course est supprimée.", obj{"removed": obj{"id": id, "name": name, "start_date": f.start}})

	case "add_participation":
		return done("Bob est ajouté.", obj{"participation": obj{"id": f.id("par"), "runner": f.person(str("runner")), "status": str("status"), "confirmed": false}})
	case "remove_participation":
		proceed, answer := f.guard(tool, args, true, "Bob, à Trail 0, ajoutée par "+me+".")
		if !proceed {
			return answer, ""
		}
		return done("Participation de Bob retirée.", obj{"removed": obj{"id": str("participation_id"), "runner": f.person("Bob")}})
	case "add_comment":
		return done("Commentaire ajouté.", obj{"comment": obj{"id": "com000000000001", "body": str("body")}})
	case "delete_comment":
		proceed, answer := f.guard(tool, args, true, "Le commentaire serait perdu.")
		if !proceed {
			return answer, ""
		}
		return done("Commentaire supprimé.", obj{"removed": obj{"id": str("comment_id")}})
	case "add_offer":
		return done("Voiture ajoutée.", obj{"offer": obj{"id": "off000000000001", "kind": "ride", "seats": 3, "taken": 0, "owner": f.person(me), "members": []any{}}})
	case "offer_place":
		if str("action") == "take" {
			return done("Bob a une place.", obj{"offer": obj{"id": str("offer_id"), "seats": 3, "taken": 1, "members": []any{obj{"place_id": "pla", "runner": f.person("Bob")}}}})
		}
		proceed, answer := f.guard(tool, args, true, "Bob perdrait sa place.")
		if !proceed {
			return answer, ""
		}
		return done("La place de Bob est libérée.", obj{"offer": obj{"id": str("offer_id"), "seats": 3, "taken": 0, "members": []any{}}})
	case "delete_offer":
		proceed, answer := f.guard(tool, args, true, "La voiture serait perdue.")
		if !proceed {
			return answer, ""
		}
		return done("Voiture supprimée.", obj{"removed": obj{"id": str("offer_id")}})

	case "start_upload":
		f.slotOpen = true
		return obj{"upload_id": "upl000000000001", "upload_url": f.base() + "/api/app/mcp-uploads/upl000000000001", "secret": f.uploadSecret,
			"expires_at": "2026-11-03T12:00:00Z", "max_bytes": 10 << 20, "accepted": "GPX",
			"command": `curl -sS -X PUT -H "X-Upload-Secret: ` + f.uploadSecret + `" --data-binary @<fichier> ` + f.base() + "/api/app/mcp-uploads/upl000000000001"}, ""
	case "set_track":
		if !f.slotOpen || f.uploaded == nil || str("upload_id") != "upl000000000001" {
			return nil, "Le fichier n'est pas arrivé."
		}
		f.slotOpen = false
		for _, format := range f.formats {
			if format.id == str("format_id") && args["use_track_values"] == true {
				format.distance = 7.7
			}
		}
		return done("La trace est posée.", obj{
			"format": obj{"id": str("format_id"), "title": "Trail 7.7 km", "track_url": f.base() + "/files/track.gpx"},
			"track":  obj{"points": bytes.Count(f.uploaded, []byte("<trkpt")), "distance_km": 7.7, "elevation_gain_m": 300},
		})
	case "set_photo":
		if args["remove"] == true {
			proceed, answer := f.guard(tool, args, f.hasPhoto, "La photo serait retirée.")
			if !proceed {
				return answer, ""
			}
			f.hasPhoto = false
			return done("La photo est retirée.", obj{"runner": f.person(me)})
		}
		data, err := base64.StdEncoding.DecodeString(str("content_base64"))
		if err != nil || !bytes.HasPrefix(data, []byte("\x89PNG")) {
			return nil, "Ce fichier n'est pas une photo."
		}
		proceed, answer := f.guard(tool, args, f.hasPhoto, "La photo serait remplacée.")
		if !proceed {
			return answer, ""
		}
		f.hasPhoto = true
		runner := f.person(me)
		runner["photo_url"] = f.base() + "/files/photo.png"
		return done("La photo est changée.", obj{"runner": runner})
	case "update_format":
		moved := str("date") != ""
		proceed, answer := f.guard(tool, args, moved, "Alice est inscrite à cette épreuve.")
		if !proceed {
			return answer, ""
		}
		for _, format := range f.formats {
			if format.id == str("format_id") && moved {
				format.date = str("date")
				f.end = format.date
			}
		}
		return done("L'épreuve est modifiée.", f.eventDetail())
	case "delete_format":
		proceed, answer := f.guard(tool, args, true, "L'épreuve et ses inscrits partent.")
		if !proceed {
			return answer, ""
		}
		f.formats = slices.DeleteFunc(f.formats, func(format *fakeFormat) bool { return format.id == str("format_id") })
		return done("L'épreuve est supprimée.", f.eventDetail())

	case "calendar_link":
		return done("Le lien d'agenda.", obj{"exists": true, "url": f.base() + "/api/app/calendar/abcdefghijklmnop.ics"})
	case "passkeys":
		return done("Ses clés d'accès.", obj{"runner": f.person(me), "passkeys": []any{}})
	case "mcp_tokens":
		if str("action") == "revoke" {
			proceed, answer := f.guard(tool, args, true, "Le jeton cesserait de marcher.")
			if !proceed {
				return answer, ""
			}
			id := str("token_id")
			for token, tokenID := range f.tokens {
				if tokenID == id {
					delete(f.tokens, token)
					f.revokedIDs = append(f.revokedIDs, id)
				}
			}
			return done("Jeton révoqué.", obj{"revoked": obj{"id": id, "name": "mcpcheck", "current": id == "tok00000000001"}})
		}
		tokens := []any{}
		for _, id := range slices.Sorted(maps.Values(f.tokens)) {
			tokens = append(tokens, obj{"id": id, "name": "mcpcheck", "created": "2026-11-03 10:00:00.000Z", "current": id == "tok00000000001"})
		}
		return done("Ses jetons.", obj{"tokens": tokens})

	case "admin_list_members":
		return obj{"members": []any{obj{"runner": f.person("Admin"), "state": "active", "role": "admin", "participations": 0}}}, ""
	case "admin_create_runner":
		return done("Le coureur est ajouté.", obj{"runner": obj{"id": f.id("run"), "name": str("name")}})
	case "admin_create_link":
		// Always asked, an invitation as a member too.
		proceed, answer := f.guard(tool, args, true, "Ce lien permet à qui l'ouvre de créer le compte de Test MCP, avec le rôle membre.")
		if !proceed {
			return answer, ""
		}
		expires := time.Now().UTC().Add(7 * 24 * time.Hour).Format(time.RFC3339)
		return done("Le lien est fait.", obj{"url": f.base() + "/invitation#abcdefghijklmnopqrstuvwxyz", "expires_at": expires})
	case "admin_revoke_link":
		proceed, answer := f.guard(tool, args, true, "Le lien d'invitation en attente cesserait de marcher.")
		if !proceed {
			return answer, ""
		}
		return done("Le lien est révoqué.", obj{"revoked": obj{"id": "inv000000000001", "kind": str("kind"), "expires_at": "2026-11-10"}})
	case "admin_create_race_type":
		return done("Le type est ajouté.", obj{"race_type": obj{"id": f.id("typ"), "label": str("label")}})
	case "admin_delete_race_type":
		proceed, answer := f.guard(tool, args, true, "Le type serait supprimé.")
		if !proceed {
			return answer, ""
		}
		return done("Le type est supprimé.", obj{"removed": obj{"id": "typ", "label": str("race_type")}})
	case "admin_merge":
		proceed, answer := f.guard(tool, args, true, "1 épreuve déplacée")
		if !proceed {
			return answer, ""
		}
		f.counts[f.names[str("merge_id")]]--
		return done("Les courses sont fusionnées.", obj{
			"result": obj{"movedFormats": 1, "movedParticipations": 0, "droppedParticipations": 0, "clearedFormatDates": 0, "movedComments": 0, "movedOffers": 0},
			"kept":   obj{"id": str("keep_id"), "name": f.names[str("keep_id")]},
		})
	case "admin_delete_runner":
		proceed, answer := f.guard(tool, args, true, "Le coureur serait supprimé.")
		if !proceed {
			return answer, ""
		}
		return done("Le coureur est supprimé.", obj{"removed": f.person(str("runner"))})
	}
	return nil, "outil inconnu du faux site : " + tool
}

// ---------------------------------------------------------------------------
// The runs

// runAgainst runs mcpcheck against the fake site, and gives its lines and the
// error that stopped it.
func runAgainst(t *testing.T, f *fakeSite, args []string, env map[string]string) (string, error) {
	t.Helper()
	opts, err := parseOptions(append([]string{"-url", f.url()}, args...), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	err = run(ctx, opts, func(key string) string { return env[key] }, &out, 0)
	t.Logf("the lines of the run (error: %v):\n%s", err, out.String())
	return out.String(), err
}

// lines are the lines of the output, with the order they were written in.
func lines(out string) []string {
	return strings.Split(strings.TrimSuffix(out, "\n"), "\n")
}

// wantLines checks that each line is in the output, whole, in that order.
func wantLines(t *testing.T, out string, wants ...string) {
	t.Helper()
	got := lines(out)
	next := 0
	for _, want := range wants {
		found := false
		for ; next < len(got); next++ {
			if got[next] == want {
				found = true
				next++
				break
			}
		}
		if !found {
			t.Errorf("the line %q is not there, or not in its place:\n%s", want, out)
		}
	}
}

// wantPrefixes is wantLines for the lines whose end depends on the data.
func wantPrefixes(t *testing.T, out string, wants ...string) {
	t.Helper()
	got := lines(out)
	next := 0
	for _, want := range wants {
		found := false
		for ; next < len(got); next++ {
			if strings.HasPrefix(got[next], want) {
				found = true
				next++
				break
			}
		}
		if !found {
			t.Errorf("no line starts with %q, or not in its place:\n%s", want, out)
		}
	}
}

// noFailure checks that no step failed.
func noFailure(t *testing.T, out string, err error) {
	t.Helper()
	if err != nil {
		t.Errorf("the run failed: %v", err)
	}
	for _, line := range lines(out) {
		if strings.HasPrefix(line, "FAIL") {
			t.Errorf("a step failed: %s", line)
		}
	}
}

// noSecret checks that nothing that the site hands out is in the output, and
// nothing that looks like it.
func noSecret(t *testing.T, f *fakeSite, out string) {
	t.Helper()
	forbidden := []string{f.session, f.mcpToken, f.uploadSecret, "ptd_", "cfm_", "ptu_", "invitation#", ".ics", "Bearer", "eyJ", "LEAKED"}
	f.mu.Lock()
	forbidden = append(forbidden, f.issued...)
	f.mu.Unlock()
	for _, secret := range forbidden {
		if strings.Contains(out, secret) {
			t.Errorf("the output holds %q:\n%s", secret, out)
		}
	}
}

// clean checks that the run left nothing behind: no race, no photo, no token.
func clean(t *testing.T, f *fakeSite) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	for name, n := range f.counts {
		if n != 0 {
			t.Errorf("%d races called %q are left", n, name)
		}
	}
	if f.hasPhoto {
		t.Error("a photo is left")
	}
	if len(f.tokens) != 0 {
		t.Errorf("%d tokens are left", len(f.tokens))
	}
}

func TestRun_ReadOnly(t *testing.T) {
	f := newFakeSite(t, false)
	out, err := runAgainst(t, f, []string{"-login", "alice@example.test"}, nil)
	noFailure(t, out, err)
	noSecret(t, f, out)

	wantLines(t, out,
		"ok   initialize — prends-ton-dossard",
		"ok   tools/list — 34 outils (membre)",
		"ok   whoami — Alice",
	)
	wantPrefixes(t, out, "ok   home — ", "ok   list_race_types — 2 types", "ok   search_events — 2 courses à venir", "ok   get_stats — année 2026")
	wantLines(t, out, "ok   jeton révoqué — 401")

	for _, tool := range f.calls {
		if !slices.Contains([]string{"whoami", "home", "list_race_types", "search_events", "get_stats"}, tool) {
			t.Errorf("the read-only run called %s", tool)
		}
	}
	clean(t, f)
}

func TestRun_ReadOnly_WithTheTokenOfTheUser(t *testing.T) {
	f := newFakeSite(t, false)
	f.tokens[f.mcpToken] = "tok00000000001"
	out, err := runAgainst(t, f, nil, map[string]string{"PTD_MCP_TOKEN": f.mcpToken})
	noFailure(t, out, err)
	noSecret(t, f, out)
	wantLines(t, out, "ok   initialize — prends-ton-dossard", "ok   whoami — Alice")
	if strings.Contains(out, "jeton révoqué") {
		t.Errorf("the token of the user is revoked:\n%s", out)
	}
	if !f.valid(f.mcpToken) {
		t.Error("the token of the user does not work any more")
	}
}

func TestRun_Write_AsAMember(t *testing.T) {
	f := newFakeSite(t, false)
	out, err := runAgainst(t, f, []string{"-login", "alice@example.test", "-write"}, nil)
	noFailure(t, out, err)
	noSecret(t, f, out)

	wantLines(t, out,
		"ok   initialize — prends-ton-dossard",
		"ok   tools/list — 34 outils (membre)",
		"ok   whoami — Alice",
		"ok   admin_merge — outil inconnu pour un membre",
		"ok   create_event — « Course de test MCP »",
		"ok   create_event — doublon : confirmation demandée, rien créé",
		"ok   remove_participation — confirmation demandée",
		"ok   remove_participation — mauvaise confirmation refusée",
		"ok   remove_participation — confirmé, Bob retiré",
		"ok   remove_participation — confirmation déjà servie, refusée",
		fmt.Sprintf("ok   set_track — envoi en deux temps, %d points", bytes.Count(trackGPX, []byte("<trkpt"))),
		"ok   delete_event — confirmé",
		"ok   jeton révoqué — 401",
	)
	for _, tool := range f.calls {
		if strings.HasPrefix(tool, "admin_") {
			t.Errorf("a member called %s", tool)
		}
	}
	clean(t, f)
}

func TestRun_Write_AsAnAdmin(t *testing.T) {
	f := newFakeSite(t, true)
	out, err := runAgainst(t, f, []string{"-login", "admin@example.test", "-write"}, nil)
	noFailure(t, out, err)
	noSecret(t, f, out)

	wantLines(t, out,
		"ok   initialize — prends-ton-dossard",
		"ok   tools/list — 45 outils (admin)",
		"ok   whoami — Admin",
		"ok   create_event — « Course de test MCP »",
		"ok   delete_event — confirmé",
	)
	wantPrefixes(t, out, "ok   admin_create_link — confirmé, lien reçu, expire le 20")
	wantLines(t, out,
		"ok   admin_merge — aperçu, puis fusion",
		"ok   admin_delete_runner — confirmé",
		"ok   jeton révoqué — 401",
	)
	if strings.Contains(out, "outil inconnu") {
		t.Errorf("an admin is told that admin_merge is unknown:\n%s", out)
	}
	for _, tool := range []string{"admin_create_runner", "admin_create_link", "admin_revoke_link", "admin_create_race_type", "admin_delete_race_type", "admin_merge", "admin_delete_runner"} {
		if !slices.Contains(f.calls, tool) {
			t.Errorf("an admin run does not call %s", tool)
		}
	}
	clean(t, f)
}

func TestRun_AFailureIsReportedWithoutTheSecret(t *testing.T) {
	f := newFakeSite(t, false)
	f.leak = true // the site repeats a token, a confirmation and an invitation in what it says
	out, err := runAgainst(t, f, []string{"-login", "alice@example.test", "-write"}, nil)
	noSecret(t, f, out)
	if err == nil {
		t.Fatal("the run does not fail although a step does")
	}

	got := lines(out)
	failed := -1
	for i, line := range got {
		if strings.HasPrefix(line, "FAIL create_event — ") {
			failed = i
		}
	}
	if failed < 0 {
		t.Fatalf("no FAIL line for create_event:\n%s", out)
	}
	for _, line := range got[failed+1:] {
		if strings.HasPrefix(line, "ok") && !strings.HasPrefix(line, "ok   jeton révoqué") {
			t.Errorf("a step ran after the failure: %s", line)
		}
	}
	if slices.Contains(f.calls, "update_event") {
		t.Error("the run went on after the failure")
	}
	// The token of the run is revoked whatever happens.
	wantPrefixes(t, out, "ok   jeton révoqué — ")
	if len(f.tokens) != 0 {
		t.Errorf("%d tokens are left after the failure", len(f.tokens))
	}
}

func TestRun_AServerThatRefusesTheToken(t *testing.T) {
	f := newFakeSite(t, false)
	f.refuse = true
	out, err := runAgainst(t, f, []string{"-login", "alice@example.test"}, nil)
	if err == nil {
		t.Fatal("the run does not fail although the server refuses the token")
	}
	noSecret(t, f, out)
	wantPrefixes(t, out, "FAIL initialize — ")
}

func TestRun_NoToken(t *testing.T) {
	f := newFakeSite(t, false)
	out, err := runAgainst(t, f, nil, nil)
	if err == nil {
		t.Fatal("the run does not fail without a token")
	}
	wantPrefixes(t, out, "FAIL jeton — ")
	if !strings.Contains(out, "PTD_MCP_TOKEN") {
		t.Errorf("the line does not say where the token comes from:\n%s", out)
	}
	if len(f.calls) != 0 {
		t.Errorf("the run called %v without a token", f.calls)
	}
}

func TestRun_TheWrongPasswordIsNotPrinted(t *testing.T) {
	f := newFakeSite(t, false)
	const password = "not-the-password-of-the-seed"
	out, err := runAgainst(t, f, []string{"-login", "alice@example.test"}, map[string]string{"PTD_PASSWORD": password})
	if err == nil {
		t.Fatal("the run does not fail with a password that the site refuses")
	}
	wantPrefixes(t, out, "FAIL connexion — ")
	if strings.Contains(out, password) {
		t.Errorf("the password is in the output:\n%s", out)
	}
}

func TestRealMain_ExitStatus(t *testing.T) {
	for name, tc := range map[string]struct {
		args   []string
		status int
		stderr string
	}{
		"help":                       {[]string{"-h"}, 0, "-write"},
		"a flag that does not exist": {[]string{"-verbose"}, 2, "verbose"},
		"write on the real site":     {[]string{"-url", production, "-write"}, 2, "-write"},
		"login on the real site":     {[]string{"-url", production, "-login", "alice@example.test"}, 2, "-login"},
	} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if status := realMain(tc.args, func(string) string { return "" }, &stdout, &stderr); status != tc.status {
				t.Errorf("the status is %d, not %d", status, tc.status)
			}
			if !strings.Contains(stderr.String(), tc.stderr) {
				t.Errorf("stderr does not say %q:\n%s", tc.stderr, stderr.String())
			}
			if stdout.Len() != 0 {
				t.Errorf("nothing was run, yet stdout says:\n%s", stdout.String())
			}
		})
	}

	t.Run("a failing run", func(t *testing.T) {
		f := newFakeSite(t, false)
		var stdout, stderr bytes.Buffer
		status := realMain([]string{"-url", f.url()}, func(string) string { return "" }, &stdout, &stderr)
		if status != 1 {
			t.Errorf("the status is %d, not 1", status)
		}
	})
}

// base is the address that the site gives of itself: its APP_URL.
func (f *fakeSite) base() string {
	switch {
	case f.elsewhere:
		return "http://prends.example.test:9"
	case f.asLocalhost:
		return strings.Replace(f.server.URL, "127.0.0.1", "localhost", 1)
	}
	return f.server.URL
}

func TestRun_Write_TheSiteIsKnownAsLocalhost(t *testing.T) {
	// The server cannot start with APP_URL=http://127.0.0.1:8090 (a passkey wants a
	// domain): it says localhost, and the check reaches it by 127.0.0.1.
	f := newFakeSite(t, true)
	f.asLocalhost = true
	out, err := runAgainst(t, f, []string{"-login", "admin@example.test", "-write"}, nil)
	noFailure(t, out, err)
	noSecret(t, f, out)
	wantLines(t, out, "ok   set_track — envoi en deux temps, 40 points", "ok   admin_merge — aperçu, puis fusion", "ok   jeton révoqué — 401")
	clean(t, f)
}

func TestRun_Write_TheUploadAddressIsNotThisServer(t *testing.T) {
	// A server started without its APP_URL says the address of Vite: the file would
	// go to the wrong place, and the check says so instead of sending it.
	f := newFakeSite(t, false)
	f.elsewhere = true
	out, err := runAgainst(t, f, []string{"-login", "alice@example.test", "-write"}, nil)
	if err == nil {
		t.Fatal("the run does not fail although the upload address is not this server")
	}
	noSecret(t, f, out)
	wantPrefixes(t, out, "FAIL start_upload — ")
	if !strings.Contains(out, "APP_URL=http://localhost") {
		t.Errorf("the line does not say what to do:\n%s", out)
	}
	if f.uploaded != nil {
		t.Error("a file was sent although the address is not this server's")
	}
}
