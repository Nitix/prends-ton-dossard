// Command mcpcheck is a real MCP client, built on the official SDK, that walks
// through the MCP server of the site the way an assistant does: it connects,
// lists the tools, and calls them. It is the end-to-end check of the server.
//
//	go run ./tools/mcpcheck [-url URL] [-login EMAIL] [-write]
//
// Without -write it only reads (initialize, tools/list, whoami, home,
// list_race_types, search_events, get_stats): it may be pointed at the real
// site, with the token of the user in PTD_MCP_TOKEN.
//
// -login EMAIL and -write are for a server on this machine only (localhost,
// 127.0.0.1): -login signs in to the local site with the password of
// PTD_PASSWORD (the seed's, by default), makes a token named « mcpcheck » through
// the routes of the site, and revokes it when the run ends, even on a failure;
// -write creates, changes and deletes races, participations, comments, offers,
// files, and for an admin runners, links, race types and duplicates, then puts
// everything back.
//
// The server must have been started with APP_URL set to its own address: the
// address that start_upload gives for a file is built from it, and the check
// sends the file there as it is. The server refuses to start with an IP address
// as APP_URL (a passkey wants a domain), so on this machine that is
// APP_URL=http://localhost:8090, whichever of localhost and 127.0.0.1 -url says.
//
// One line per step, « ok   <step> — <what it saw> » or « FAIL <step> — <why> »,
// and the exit status 1 at the first failure. No line holds a token of any kind,
// an upload secret, an invitation address or a calendar address: see reporter.
package main

import (
	"bytes"
	"cmp"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"maps"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	_ "time/tzdata"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// The files that the write steps send: a small track and a small photo, made by
// the generators of the tests of the server (testutil.GPX and testutil.PNG).
// TestTestdata_AreWhatTheGeneratorsMake keeps them so.
var (
	//go:embed testdata/track.gpx
	trackGPX []byte
	//go:embed testdata/photo.png
	photoPNG []byte
)

const (
	defaultURL      = "http://127.0.0.1:8090/mcp"
	defaultPassword = "courses-dev-password" // the password of the seed
	serverName      = "prends-ton-dossard"
	tokenName       = "mcpcheck"

	// The names of what the write steps make: their own, so that a run never
	// touches what a person made.
	raceName      = "Course de test MCP"
	duplicateName = "Doublon MCP"
	testName      = "Test MCP"

	memberTools = 32
	adminTools  = 43
	adminPrefix = "admin_"

	// defaultPace is the time left before each call: the site's own limits (20
	// creations in 5 seconds, 3 batches a second, 300 requests in 10 seconds)
	// apply to what a tool asks of the API, as they do to the browser.
	defaultPace = 400 * time.Millisecond
)

// ---------------------------------------------------------------------------
// The options

// options are what the command line says.
type options struct {
	URL   string
	Login string
	Write bool
}

// parseOptions reads the command line, and refuses what must not be done: -write
// and -login on a server that is not on this machine. Nothing is contacted.
// The usage goes to stderr; flag.ErrHelp is what -h gives.
func parseOptions(args []string, stderr io.Writer) (options, error) {
	var o options
	flags := flag.NewFlagSet("mcpcheck", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.Usage = func() {}
	flags.StringVar(&o.URL, "url", defaultURL, "l'adresse du serveur MCP")
	flags.StringVar(&o.Login, "login", "", "l'email du compte avec lequel se connecter pour faire un jeton d'essai, révoqué à la fin (un serveur local seulement)")
	flags.BoolVar(&o.Write, "write", false, "essayer aussi les outils qui écrivent, puis tout remettre en place (un serveur local seulement)")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			flags.SetOutput(stderr)
			fmt.Fprintln(stderr, "Usage : go run ./tools/mcpcheck [-url URL] [-login EMAIL] [-write]")
			flags.PrintDefaults()
			fmt.Fprintln(stderr, "\nSans -login, le jeton est celui de la variable PTD_MCP_TOKEN. Avec -login, le mot de passe est celui de PTD_PASSWORD (celui du seed par défaut).")
		}
		return options{}, err
	}
	if flags.NArg() > 0 {
		return options{}, fmt.Errorf("arguments inattendus : %s (voir -h)", strings.Join(flags.Args(), " "))
	}
	if err := o.validate(); err != nil {
		return options{}, err
	}
	return o, nil
}

// validate checks the address, and that -write and -login only go to a server on
// this machine: a run that writes would leave its mark on a real site, and a
// login would put the password of the seed to the test.
func (o options) validate() error {
	u, err := serverURL(o.URL)
	if err != nil {
		return err
	}
	for _, asked := range []struct {
		flag string
		set  bool
	}{{"-write", o.Write}, {"-login", o.Login != ""}} {
		if asked.set && !isLocal(u) {
			return fmt.Errorf("%s n'est permis que pour un serveur local (localhost, 127.0.0.1), pas pour %s", asked.flag, u.Host)
		}
	}
	return nil
}

// serverURL reads the address of the server: http or https, a host, and nothing
// that hides another host (credentials).
func serverURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	switch {
	case err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "":
		return nil, errors.New("l'adresse du serveur doit être complète, comme http://127.0.0.1:8090/mcp")
	case u.User != nil:
		return nil, errors.New("l'adresse du serveur ne doit pas contenir d'identifiants")
	}
	return u, nil
}

// isLocal says that the server is on this machine: localhost, or a loopback
// address. Not a name that merely starts with them (localhost.example.test).
func isLocal(u *url.URL) bool {
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// ---------------------------------------------------------------------------
// The lines

// reporter writes the lines of the run, and is the one place where something
// leaves the program: it never lets a secret out, whatever a server answers.
// The secrets it knows by value are given to add (the token of the run, the
// session, a confirmation, an upload secret, an address that carries one); the
// ones that have a form are cut out wherever they are, even when nobody added
// them.
type reporter struct {
	out     io.Writer
	mu      sync.Mutex
	secrets []string
}

// add makes the reporter hide a value from now on.
func (r *reporter) add(secret string) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.secrets = append(r.secrets, secret)
}

// shapes are the secrets that are known by their form: the tokens of the MCP
// (ptd_), of a confirmation (cfm_) and of an upload (ptu_), the Bearer header,
// a session (a JWT), the address of an invitation, the address of a calendar.
var shapes = []struct {
	pattern *regexp.Regexp
	hidden  string
}{
	{regexp.MustCompile(`Bearer\s+\S+`), "[jeton]"},
	{regexp.MustCompile(`ptd_[A-Za-z0-9_-]+`), "[jeton MCP]"},
	{regexp.MustCompile(`cfm_[A-Za-z0-9_-]+`), "[jeton de confirmation]"},
	{regexp.MustCompile(`ptu_[A-Za-z0-9_-]+`), "[secret d'envoi]"},
	{regexp.MustCompile(`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*`), "[jeton de session]"},
	{regexp.MustCompile(`\S*invitation#\S*`), "[lien d'invitation]"},
	{regexp.MustCompile(`\S*\.ics\S*`), "[lien d'agenda]"},
}

// clean is s on one line, without any secret.
func (r *reporter) clean(s string) string {
	r.mu.Lock()
	secrets := slices.Clone(r.secrets)
	r.mu.Unlock()
	// The longest first: a secret that holds another is hidden whole.
	slices.SortFunc(secrets, func(a, b string) int { return cmp.Compare(len(b), len(a)) })
	for _, secret := range secrets {
		s = strings.ReplaceAll(s, secret, "[secret]")
	}
	for _, shape := range shapes {
		s = shape.pattern.ReplaceAllString(s, shape.hidden)
	}
	return strings.Join(strings.Fields(s), " ")
}

// ok writes the line of a step that went as expected.
func (r *reporter) ok(step, saw string) {
	r.line("ok  ", step, saw)
}

// fail writes the line of the step that did not.
func (r *reporter) fail(step, why string) {
	r.line("FAIL", step, why)
}

func (r *reporter) line(mark, step, text string) {
	line := mark + " " + step + " — " + r.clean(text) + "\n"
	r.mu.Lock()
	defer r.mu.Unlock()
	io.WriteString(r.out, line)
}

// ---------------------------------------------------------------------------
// What a server answers

// body is a JSON object that an answer holds, read by the path of its keys.
type body map[string]any

// at is the value at the path, or nil.
func (b body) at(path ...string) any {
	var current any = map[string]any(b)
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func (b body) text(path ...string) string { s, _ := b.at(path...).(string); return s }
func (b body) flag(path ...string) bool   { v, _ := b.at(path...).(bool); return v }
func (b body) number(path ...string) float64 {
	v, _ := b.at(path...).(float64)
	return v
}
func (b body) has(path ...string) bool { return b.at(path...) != nil }

// list is the objects of a list (none for what is not one).
func (b body) list(path ...string) []body {
	items, _ := b.at(path...).([]any)
	out := make([]body, 0, len(items))
	for _, item := range items {
		object, _ := item.(map[string]any)
		out = append(out, body(object))
	}
	return out
}

// texts is the texts of a list.
func (b body) texts(path ...string) []string {
	items, _ := b.at(path...).([]any)
	var out []string
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// sub is the object at the path (empty for what is not one).
func (b body) sub(path ...string) body {
	object, _ := b.at(path...).(map[string]any)
	return body(object)
}

// isList says that the value at the path is a list, empty or not.
func (b body) isList(path ...string) bool {
	_, ok := b.at(path...).([]any)
	return ok
}

// reply is the answer of a tool: what it says in structuredContent, the text
// that goes with it (the JSON, or the message of an error), and whether the
// server calls it an error.
type reply struct {
	data    body
	text    string
	isError bool
}

// ok checks that the call is not an error of the tool.
func (r reply) ok() error {
	if r.isError {
		return fmt.Errorf("le serveur répond par une erreur : %s", cmp.Or(r.text, "(sans texte)"))
	}
	return nil
}

// done checks that the tool did what it was asked: no error, and done is true.
func (r reply) done() error {
	if err := r.ok(); err != nil {
		return err
	}
	if !r.data.flag("done") {
		return fmt.Errorf("rien n'a été fait : %s", cmp.Or(r.data.text("summary"), r.text))
	}
	return nil
}

// notDone is what a refused call says: its error, or the summary of an answer that
// did nothing. It is empty for a call that was done.
func (r reply) notDone() string {
	switch {
	case r.isError:
		return cmp.Or(r.text, "une erreur")
	case !r.data.flag("done"):
		return cmp.Or(r.data.text("summary"), "rien n'a été fait")
	}
	return ""
}

// ---------------------------------------------------------------------------
// The check

// bearer adds the token to every request, and notes the status of the last POST,
// which is where a 401 shows: the SDK tells an error, not why.
type bearer struct {
	token string
	next  http.RoundTripper
	last  atomic.Int32
}

func (b *bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	response, err := b.next.RoundTrip(r)
	if err == nil && r.Method == http.MethodPost {
		b.last.Store(int32(response.StatusCode))
	}
	return response, err
}

// errFailed is what run returns once a step has failed (its line is written).
var errFailed = errors.New("une étape a échoué")

// checker is a run: the session of the client, who it is, and the first failure.
type checker struct {
	ctx    context.Context
	rep    *reporter
	pace   time.Duration
	mcpURL string
	origin string
	site   *http.Client // the routes of the site and the files: no MCP token
	rt     *bearer
	cs     *mcpsdk.ClientSession

	// The sign-in of -login: a session of the site, and the token made with it.
	session string
	token   string
	tokenID string
	revoked bool

	// Who the token is, from whoami.
	who body
	// appURL is the address of the site as whoami says it (APP_URL): where the links go.
	appURL string
	role   string
	me     string
	today  time.Time

	raceType string // a race type to give the formats of the races made
	failed   error
}

// step runs a step unless an earlier one failed, and writes its line.
func (c *checker) step(name string, run func() (string, error)) {
	if c.failed != nil {
		return
	}
	saw, err := run()
	if err != nil {
		c.rep.fail(name, err.Error())
		c.failed = errFailed
		return
	}
	c.rep.ok(name, saw)
}

// callTool calls a tool, after the pause that the limits of the site ask for.
func (c *checker) callTool(name string, args map[string]any) (*mcpsdk.CallToolResult, error) {
	if c.pace > 0 {
		time.Sleep(c.pace)
	}
	if args == nil {
		args = map[string]any{}
	}
	return c.cs.CallTool(c.ctx, &mcpsdk.CallToolParams{Name: name, Arguments: args})
}

// call calls a tool and reads its answer. A JSON-RPC error is an error here; a tool
// that fails answers a reply with isError.
func (c *checker) call(name string, args map[string]any) (reply, error) {
	result, err := c.callTool(name, args)
	if err != nil {
		return reply{}, fmt.Errorf("%s : %w", name, err)
	}
	r := reply{isError: result.IsError}
	for _, content := range result.Content {
		if text, ok := content.(*mcpsdk.TextContent); ok {
			r.text = text.Text
			break
		}
	}
	if object, ok := result.StructuredContent.(map[string]any); ok {
		r.data = body(object)
	}
	return r, nil
}

// callOK is call, for an answer that is not an error of the tool.
func (c *checker) callOK(name string, args map[string]any) (reply, error) {
	r, err := c.call(name, args)
	if err != nil {
		return r, err
	}
	return r, r.ok()
}

// callDone is call, for an answer that did what was asked.
func (c *checker) callDone(name string, args map[string]any) (reply, error) {
	r, err := c.call(name, args)
	if err != nil {
		return r, err
	}
	return r, r.done()
}

// asked checks that a call did nothing and asked for a confirmation, and gives
// its token. The tokens are secrets: the reporter hides them from now on.
func (c *checker) asked(r reply) (string, error) {
	if err := r.ok(); err != nil {
		return "", err
	}
	if r.data.flag("done") {
		return "", errors.New("c'est fait sans confirmation")
	}
	token := r.data.text("confirmation", "token")
	if !strings.HasPrefix(token, "cfm_") {
		return "", fmt.Errorf("pas de jeton de confirmation : %s", cmp.Or(r.data.text("summary"), r.text))
	}
	c.rep.add(token)
	if r.data.text("confirmation", "message") == "" || !r.data.isList("confirmation", "details") {
		return "", errors.New("la confirmation ne dit pas ce qui serait perdu")
	}
	expires, err := time.Parse(time.RFC3339, r.data.text("confirmation", "expires_at"))
	if err != nil {
		return "", errors.New("la confirmation n'a pas de date de fin lisible")
	}
	if left := time.Until(expires); left < 9*time.Minute || left > 11*time.Minute {
		return "", fmt.Errorf("la confirmation vaut %s, pas 10 minutes", left.Round(time.Second))
	}
	return token, nil
}

// with is the arguments of a call and the confirmation that the second call gives.
func with(args map[string]any, token string) map[string]any {
	confirmed := maps.Clone(args)
	confirmed["confirmation"] = token
	return confirmed
}

// confirmed is a call that asks for a confirmation, and then, with its token,
// does it: the step of a person who says yes. It gives the answer of the second
// call and what the confirmation said.
func (c *checker) confirmed(name string, args map[string]any) (reply, body, error) {
	first, err := c.call(name, args)
	if err != nil {
		return reply{}, nil, err
	}
	token, err := c.asked(first)
	if err != nil {
		return first, nil, err
	}
	second, err := c.callDone(name, with(args, token))
	return second, first.data, err
}

// ---------------------------------------------------------------------------
// The sign-in, and the token

// request sends a JSON request to a route of the site (not to the MCP), and reads the
// answer that has one. The refusals say the status and the message of the site, and
// never what was sent or received.
func (c *checker) request(method, path, session string, in, out any) error {
	var payload io.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(c.ctx, method, c.origin+path, payload)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if session != "" {
		req.Header.Set("Authorization", session)
	}
	response, err := c.site.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s : %w", method, path, err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode >= 300 {
		var refusal struct {
			Message string `json:"message"`
		}
		json.Unmarshal(data, &refusal)
		return fmt.Errorf("%s %s : HTTP %d %s", method, path, response.StatusCode, refusal.Message)
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("%s %s : une réponse illisible", method, path)
		}
	}
	return nil
}

// signIn signs in to the site with the password, as the form does.
func (c *checker) signIn(email, password string) error {
	var auth struct {
		Token string `json:"token"`
	}
	err := c.request(http.MethodPost, "/api/collections/users/auth-with-password", "", map[string]string{"identity": email, "password": password}, &auth)
	if err != nil {
		return err
	}
	c.session = auth.Token
	c.rep.add(c.session)
	return nil
}

// madeToken is a token that the route of the settings has made.
type madeToken struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

// newToken makes a token as the settings page does.
func (c *checker) newToken(name string) (madeToken, error) {
	var made madeToken
	if err := c.request(http.MethodPost, "/api/app/mcp-tokens", c.session, map[string]string{"name": name}, &made); err != nil {
		return madeToken{}, err
	}
	c.rep.add(made.Token)
	return made, nil
}

// revokeToken revokes a token as the settings page does.
func (c *checker) revokeToken(id string) error {
	return c.request(http.MethodDelete, "/api/app/mcp-tokens/"+id, c.session, nil, nil)
}

// finish revokes the token of the run if it is still alive, whatever happened: it
// is the cleanup of a run that failed (the end of a run that went well revokes it
// itself, in a step).
func (c *checker) finish() {
	if c.session == "" || c.tokenID == "" || c.revoked {
		return
	}
	// The run may have been interrupted: the revocation still has its time.
	c.ctx = context.WithoutCancel(c.ctx)
	ctx, cancel := context.WithTimeout(c.ctx, 15*time.Second)
	defer cancel()
	c.ctx = ctx
	if err := c.revokeToken(c.tokenID); err != nil {
		c.rep.fail("jeton révoqué", "le jeton d'essai est resté : "+err.Error())
		return
	}
	c.revoked = true
	c.rep.ok("jeton révoqué", "après l'échec")
}

// rawStatus is the status that the server gives to a call of whoami with a token.
func (c *checker) rawStatus(token string) (int, error) {
	const call = `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}`
	req, err := http.NewRequestWithContext(c.ctx, http.MethodPost, c.mcpURL, strings.NewReader(call))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("MCP-Protocol-Version", "2025-06-18")
	response, err := c.site.Do(req)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, nil
}

// ---------------------------------------------------------------------------
// The run

var paris = func() *time.Location {
	location, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		return time.UTC
	}
	return location
}()

// plural says a count with its noun: 0 and 1 are singular, as in French.
func plural(n int, one, other string) string {
	if n < 2 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, other)
}

// day is the day n days from today, as the tools write it.
func (c *checker) day(n int) string {
	return c.today.AddDate(0, 0, n).Format(time.DateOnly)
}

// run connects to the server, goes through the steps, and gives the first failure
// (already written) or nil. pace is the time left before each call.
func run(ctx context.Context, opts options, getenv func(string) string, out io.Writer, pace time.Duration) error {
	u, err := serverURL(opts.URL)
	if err != nil {
		return err
	}
	c := &checker{
		ctx:    ctx,
		rep:    &reporter{out: out},
		pace:   pace,
		mcpURL: opts.URL,
		origin: u.Scheme + "://" + u.Host,
		site:   &http.Client{Timeout: time.Minute},
	}

	if opts.Login != "" {
		password := cmp.Or(getenv("PTD_PASSWORD"), defaultPassword)
		c.rep.add(password)
		if err := c.signIn(opts.Login, password); err != nil {
			c.rep.fail("connexion", err.Error())
			return errFailed
		}
		made, err := c.newToken(tokenName)
		if err != nil {
			c.rep.fail("jeton", err.Error())
			return errFailed
		}
		c.token, c.tokenID = made.Token, made.ID
		defer c.finish()
		c.rep.ok("jeton créé", "« "+tokenName+" »")
	} else {
		if c.token = getenv("PTD_MCP_TOKEN"); c.token == "" {
			c.rep.fail("jeton", "sans -login, le jeton est celui de la variable PTD_MCP_TOKEN, qui est vide")
			return errFailed
		}
		c.rep.add(c.token)
	}

	c.rt = &bearer{token: c.token, next: http.DefaultTransport}
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "mcpcheck", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcpsdk.StreamableClientTransport{Endpoint: opts.URL, HTTPClient: &http.Client{Transport: c.rt}}, nil)
	if err != nil {
		c.rep.fail("initialize", err.Error())
		return errFailed
	}
	defer session.Close()
	c.cs = session

	c.readSteps()
	if opts.Write {
		c.memberSteps()
		if c.role == "admin" {
			c.adminSteps()
		}
	}
	if opts.Login != "" {
		c.revokedStep()
	}
	return c.failed
}

// realMain is main with what it needs given: the arguments, the environment and the
// two outputs. It gives the exit status: 0, 1 when a step failed, 2 when the
// command line is refused.
func realMain(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	opts, err := parseOptions(args, stderr)
	switch {
	case errors.Is(err, flag.ErrHelp):
		return 0
	case err != nil:
		fmt.Fprintln(stderr, "mcpcheck :", err)
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if err := run(ctx, opts, getenv, stdout, defaultPace); err != nil {
		return 1
	}
	return 0
}

func main() {
	os.Exit(realMain(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

// ---------------------------------------------------------------------------
// Reading

// countEvents is the number of races that a search for these words finds.
func (c *checker) countEvents(query string) (int, error) {
	r, err := c.callOK("search_events", map[string]any{"query": query})
	if err != nil {
		return 0, err
	}
	return int(r.data.number("count")), nil
}

// event reads a race.
func (c *checker) event(id string) (body, error) {
	r, err := c.callOK("get_event", map[string]any{"event_id": id})
	return r.data, err
}

// noEmail checks that an answer holds no email: none of the tools says one.
func noEmail(r reply) error {
	if strings.Contains(r.text, "@") {
		return errors.New("la réponse contient un « @ » : un email ne doit jamais sortir d'un outil")
	}
	return nil
}

func (c *checker) readSteps() {
	c.step("initialize", func() (string, error) {
		init := c.cs.InitializeResult()
		switch {
		case init == nil || init.ServerInfo == nil || init.ServerInfo.Name != serverName:
			return "", fmt.Errorf("le serveur ne se présente pas comme %s", serverName)
		case strings.TrimSpace(init.Instructions) == "":
			return "", errors.New("le serveur ne donne pas ses instructions")
		}
		return init.ServerInfo.Name, nil
	})

	c.step("tools/list", func() (string, error) {
		// The role comes from whoami: the list is checked against it.
		who, err := c.callOK("whoami", nil)
		if err != nil {
			return "", err
		}
		c.who, c.role = who.data, who.data.text("role")
		if err := noEmail(who); err != nil {
			return "", fmt.Errorf("whoami : %w", err)
		}

		seen := map[string]bool{}
		admin := 0
		cursor := ""
		for {
			page, err := c.cs.ListTools(c.ctx, &mcpsdk.ListToolsParams{Cursor: cursor})
			if err != nil {
				return "", err
			}
			for _, tool := range page.Tools {
				if seen[tool.Name] {
					return "", fmt.Errorf("l'outil %s est donné deux fois", tool.Name)
				}
				if strings.TrimSpace(tool.Description) == "" {
					return "", fmt.Errorf("l'outil %s n'a pas de description", tool.Name)
				}
				seen[tool.Name] = true
				if strings.HasPrefix(tool.Name, adminPrefix) {
					admin++
				}
			}
			if cursor = page.NextCursor; cursor == "" {
				break
			}
		}
		switch c.role {
		case "member":
			if len(seen) != memberTools || admin != 0 {
				return "", fmt.Errorf("un membre voit %d outils dont %d d'admin, pas %d sans outil d'admin", len(seen), admin, memberTools)
			}
			return fmt.Sprintf("%d outils (membre)", len(seen)), nil
		case "admin":
			if len(seen) != adminTools || admin != adminTools-memberTools {
				return "", fmt.Errorf("un admin voit %d outils dont %d d'admin, pas %d dont %d", len(seen), admin, adminTools, adminTools-memberTools)
			}
			return fmt.Sprintf("%d outils (admin)", len(seen)), nil
		}
		return "", fmt.Errorf("whoami donne un rôle inconnu : %q", c.role)
	})

	c.step("whoami", func() (string, error) {
		c.me = c.who.text("runner", "name")
		if c.me == "" {
			return "", errors.New("whoami ne dit pas le nom du coureur")
		}
		if c.tokenID != "" && (c.who.text("token", "id") != c.tokenID || c.who.text("token", "name") != tokenName) {
			return "", errors.New("whoami ne reconnaît pas le jeton qui vient d'être fait")
		}
		today, err := time.Parse(time.DateOnly, c.who.text("today"))
		if err != nil {
			return "", fmt.Errorf("whoami ne donne pas un jour : %q", c.who.text("today"))
		}
		// The day is the one in Paris (a day of leeway for a run that crosses midnight).
		here, _ := time.Parse(time.DateOnly, time.Now().In(paris).Format(time.DateOnly))
		if diff := today.Sub(here); diff < -24*time.Hour || diff > 24*time.Hour {
			return "", fmt.Errorf("whoami dit qu'on est le %s, et l'horloge de Paris dit le %s", today.Format(time.DateOnly), here.Format(time.DateOnly))
		}
		c.today = today
		c.appURL = c.who.text("site")
		return c.me, nil
	})

	c.step("home", func() (string, error) {
		r, err := c.callOK("home", nil)
		if err != nil {
			return "", err
		}
		blocks := []string{"to_confirm", "registrations_to_do", "results_to_enter", "my_upcoming", "group_soon", "latest_comments"}
		for _, block := range blocks {
			if !r.data.isList(block) {
				return "", fmt.Errorf("l'accueil n'a pas de liste %s", block)
			}
		}
		return fmt.Sprintf("%d à confirmer, %s à venir, %d dans le groupe", len(r.data.list("to_confirm")), plural(len(r.data.list("my_upcoming")), "course", "courses"), len(r.data.list("group_soon"))), nil
	})

	c.step("list_race_types", func() (string, error) {
		r, err := c.callOK("list_race_types", nil)
		if err != nil {
			return "", err
		}
		types := r.data.list("race_types")
		if len(types) == 0 {
			return "", errors.New("le site n'a aucun type de course")
		}
		var labels []string
		for _, t := range types {
			if t.text("id") == "" || t.text("label") == "" || len(t.texts("measures")) == 0 {
				return "", errors.New("un type de course n'a pas d'identifiant, de nom ou de mesures")
			}
			labels = append(labels, t.text("label"))
		}
		c.raceType = labels[0]
		return fmt.Sprintf("%s (%s)", plural(len(types), "type", "types"), strings.Join(labels[:min(len(labels), 4)], ", ")), nil
	})

	c.step("search_events", func() (string, error) {
		r, err := c.callOK("search_events", nil)
		if err != nil {
			return "", err
		}
		events := r.data.list("events")
		if int(r.data.number("count")) != len(events) {
			return "", fmt.Errorf("count dit %d, la liste en a %d", int(r.data.number("count")), len(events))
		}
		last := ""
		for _, event := range events {
			if len(event.text("id")) != 15 || event.text("name") == "" || event.text("url") == "" {
				return "", errors.New("une course n'a pas d'identifiant, de nom ou d'adresse")
			}
			if day := event.text("start_date"); day < last {
				return "", errors.New("les courses à venir ne vont pas de la plus proche à la plus lointaine")
			} else {
				last = day
			}
		}
		return plural(len(events), "course", "courses") + " à venir", nil
	})

	c.step("get_stats", func() (string, error) {
		r, err := c.callOK("get_stats", nil)
		if err != nil {
			return "", err
		}
		if year := int(r.data.number("year")); year != c.today.Year() || !r.data.isList("runners") {
			return "", fmt.Errorf("les statistiques sont de l'année %d, pas de %d, ou sans liste de coureurs", year, c.today.Year())
		}
		return fmt.Sprintf("année %d, %s", c.today.Year(), plural(len(r.data.list("runners")), "coureur", "coureurs")), nil
	})
}

// revokedStep revokes the token as the settings page does, and checks that the
// next call of the client is refused with a 401.
func (c *checker) revokedStep() {
	c.step("jeton révoqué", func() (string, error) {
		if err := c.revokeToken(c.tokenID); err != nil {
			return "", err
		}
		c.revoked = true
		c.rt.last.Store(0)
		if _, err := c.callTool("whoami", nil); err == nil {
			return "", errors.New("le serveur accepte encore le jeton révoqué")
		}
		if status := c.rt.last.Load(); status != http.StatusUnauthorized {
			return "", fmt.Errorf("l'appel suivant a reçu %d, pas 401", status)
		}
		return "401", nil
	})
}

// ---------------------------------------------------------------------------
// Writing, as a member

// payload is what a race is made with: two formats, the first without a date
// (the first day of the race), the second the day after, and the person on the second.
func (c *checker) racePayload(name, location string, start int, two bool) map[string]any {
	formats := []map[string]any{{"race_type": c.raceType, "distance_km": 10}}
	payload := map[string]any{"name": name, "location": location, "start_date": c.day(start)}
	if two {
		formats = append(formats, map[string]any{"race_type": c.raceType, "distance_km": 21, "date": c.day(start + 1)})
		payload["join"] = map[string]any{"format_index": 1, "status": "registered"}
	}
	payload["formats"] = formats
	return payload
}

// mentions says that some line of a confirmation names a race.
func mentions(answer body, name string) bool {
	return strings.Contains(strings.Join(answer.texts("confirmation", "details"), "\n"), name)
}

func (c *checker) memberSteps() {
	var (
		race            = c.racePayload(raceName, "Annecy", 30, true)
		eventID         string
		undated, dated  string // the formats, by id
		before          int
		participationID string
		token           string
		commentID       string
		offerID         string
		upload          body
		points          int
		hadPhoto        bool
		secondToken     madeToken
	)

	if c.role == "member" {
		c.step("admin_merge", func() (string, error) {
			_, err := c.callTool("admin_merge", map[string]any{"kind": "events", "keep_id": "aaaaaaaaaaaaaaa", "merge_id": "bbbbbbbbbbbbbbb"})
			var wire *jsonrpc.Error
			switch {
			case err == nil:
				return "", errors.New("un membre a une réponse d'un outil d'admin")
			case !errors.As(err, &wire):
				return "", fmt.Errorf("attendu l'erreur JSON-RPC -32602, reçu : %v", err)
			case wire.Code != jsonrpc.CodeInvalidParams || wire.Message != `unknown tool "admin_merge"`:
				return "", fmt.Errorf("attendu -32602 « unknown tool \"admin_merge\" », reçu %d « %s »", wire.Code, wire.Message)
			}
			return "outil inconnu pour un membre", nil
		})
	}

	// --- A race, its formats, and « Je participe ».
	c.step("create_event", func() (string, error) {
		n, err := c.countEvents(raceName)
		if err != nil {
			return "", err
		}
		before = n
		r, err := c.call("create_event", race)
		if err != nil {
			return "", err
		}
		note := ""
		if r.ok() == nil && !r.data.flag("done") && r.data.has("confirmation") {
			// A race of an earlier run is still there: the site asks, and the person says yes.
			confirmation, err := c.asked(r)
			if err != nil {
				return "", err
			}
			if r, err = c.callDone("create_event", with(race, confirmation)); err != nil {
				return "", err
			}
			note = " (le doublon d'un essai précédent, confirmé)"
		}
		if err := r.done(); err != nil {
			return "", err
		}
		formats := r.data.list("formats")
		switch {
		case r.data.text("name") != raceName || r.data.text("start_date") != c.day(30):
			return "", errors.New("la course n'a pas le nom ou le jour demandé")
		case len(formats) != 2:
			return "", fmt.Errorf("la course a %d épreuves, pas 2", len(formats))
		case r.data.text("end_date") != c.day(31):
			return "", fmt.Errorf("la course finit le %s, le jour de sa dernière épreuve est le %s", r.data.text("end_date"), c.day(31))
		}
		eventID = r.data.text("id")
		for _, format := range formats {
			if format.text("date") == c.day(31) {
				dated = format.text("id")
				joined := false
				for _, p := range format.list("participants") {
					joined = joined || (p.text("runner", "name") == c.me && p.text("status") == "registered" && p.flag("confirmed"))
				}
				if !joined {
					return "", fmt.Errorf("%s n'est pas inscrite à l'épreuve du %s", c.me, c.day(31))
				}
			} else {
				undated = format.text("id")
			}
		}
		if len(eventID) != 15 || len(dated) != 15 || len(undated) != 15 {
			return "", errors.New("la course ou ses épreuves n'ont pas d'identifiant")
		}
		return "« " + raceName + " »" + note, nil
	})

	c.step("create_event", func() (string, error) {
		r, err := c.call("create_event", race)
		if err != nil {
			return "", err
		}
		if _, err := c.asked(r); err != nil {
			return "", err
		}
		if !mentions(r.data, raceName) {
			return "", errors.New("la confirmation ne nomme pas la course qui lui ressemble")
		}
		n, err := c.countEvents(raceName)
		if err != nil {
			return "", err
		}
		if n != before+1 {
			return "", fmt.Errorf("%d courses « %s » au lieu de %d : le doublon a été créé", n, raceName, before+1)
		}
		return "doublon : confirmation demandée, rien créé", nil
	})

	c.step("update_event", func() (string, error) {
		renamed := raceName + " renommée"
		r, err := c.callDone("update_event", map[string]any{"event_id": eventID, "name": renamed})
		if err != nil {
			return "", err
		}
		if r.data.text("name") != renamed || r.data.has("confirmation") {
			return "", errors.New("la course n'est pas renommée, ou le site a demandé une confirmation")
		}
		return "renommée, sans confirmation", nil
	})

	// --- A participation of somebody else, and its removal, which asks.
	c.step("add_participation", func() (string, error) {
		r, err := c.callDone("add_participation", map[string]any{"runner": "Bob", "format_id": undated, "status": "interested"})
		if err != nil {
			return "", err
		}
		participation := r.data.sub("participation")
		if participation.text("runner", "name") != "Bob" || participation.text("status") != "interested" || participation.flag("confirmed") || r.data.has("confirmation") {
			return "", errors.New("la participation de Bob n'est pas « intéressé », non confirmée, sans confirmation demandée")
		}
		participationID = participation.text("id")
		return "Bob ajouté, non confirmé", nil
	})

	removal := map[string]any{"participation_id": participationID}
	c.step("remove_participation", func() (string, error) {
		r, err := c.call("remove_participation", removal)
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("remove_participation", func() (string, error) {
		// A token that the site never gave.
		last := "A"
		if strings.HasSuffix(token, "A") {
			last = "B"
		}
		wrong := token[:len(token)-1] + last
		r, err := c.call("remove_participation", with(removal, wrong))
		if err != nil {
			return "", err
		}
		if err := r.ok(); err != nil {
			return "", err
		}
		if r.data.flag("done") || !strings.Contains(r.data.text("summary"), "Confirmation refusée") {
			return "", fmt.Errorf("une confirmation fausse n'est pas refusée : %s", cmp.Or(r.data.text("summary"), r.text))
		}
		return "mauvaise confirmation refusée", nil
	})
	c.step("remove_participation", func() (string, error) {
		r, err := c.callDone("remove_participation", with(removal, token))
		if err != nil {
			return "", err
		}
		if r.data.text("removed", "runner", "name") != "Bob" {
			return "", errors.New("la participation retirée n'est pas celle de Bob")
		}
		return "confirmé, Bob retiré", nil
	})
	c.step("remove_participation", func() (string, error) {
		r, err := c.call("remove_participation", with(removal, token))
		if err != nil {
			return "", err
		}
		if r.notDone() == "" {
			return "", errors.New("un jeton de confirmation a servi deux fois")
		}
		return "confirmation déjà servie, refusée", nil
	})

	// --- A comment.
	c.step("add_comment", func() (string, error) {
		r, err := c.callDone("add_comment", map[string]any{"event_id": eventID, "body": "Essai de mcpcheck : ce commentaire disparaît avec la course."})
		if err != nil {
			return "", err
		}
		if commentID = r.data.text("comment", "id"); len(commentID) != 15 {
			return "", errors.New("le commentaire n'a pas d'identifiant")
		}
		return "commentaire ajouté", nil
	})
	c.step("delete_comment", func() (string, error) {
		r, err := c.call("delete_comment", map[string]any{"comment_id": commentID})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("delete_comment", func() (string, error) {
		r, err := c.callDone("delete_comment", map[string]any{"comment_id": commentID, "confirmation": token})
		if err != nil {
			return "", err
		}
		if r.data.text("removed", "id") != commentID {
			return "", errors.New("ce n'est pas le commentaire demandé qui est supprimé")
		}
		return "confirmé", nil
	})

	// --- A ride: the owner places whom she wants, and frees a place with a confirmation.
	c.step("add_offer", func() (string, error) {
		r, err := c.callDone("add_offer", map[string]any{"event_id": eventID, "kind": "ride", "place": "Annecy, gare", "seats": 3})
		if err != nil {
			return "", err
		}
		offer := r.data.at("offer")
		if offerID = r.data.text("offer", "id"); offer == nil || len(offerID) != 15 || r.data.number("offer", "seats") != 3 || r.data.text("offer", "owner", "name") != c.me {
			return "", errors.New("la voiture n'est pas celle de la personne, avec 3 places")
		}
		return "voiture, 3 places", nil
	})
	c.step("offer_place", func() (string, error) {
		r, err := c.callDone("offer_place", map[string]any{"offer_id": offerID, "action": "take", "runner": "Bob"})
		if err != nil {
			return "", err
		}
		if r.data.number("offer", "taken") != 1 || r.data.has("confirmation") {
			return "", errors.New("Bob n'a pas la place, ou le site a demandé une confirmation")
		}
		return "Bob prend une place, sans confirmation", nil
	})
	free := map[string]any{"offer_id": offerID, "action": "free", "runner": "Bob"}
	c.step("offer_place", func() (string, error) {
		r, err := c.call("offer_place", free)
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "libérer demande une confirmation", nil
	})
	c.step("offer_place", func() (string, error) {
		r, err := c.callDone("offer_place", with(free, token))
		if err != nil {
			return "", err
		}
		if r.data.number("offer", "taken") != 0 {
			return "", errors.New("la place de Bob n'est pas libérée")
		}
		return "place libérée, confirmé", nil
	})
	c.step("delete_offer", func() (string, error) {
		r, err := c.call("delete_offer", map[string]any{"offer_id": offerID})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("delete_offer", func() (string, error) {
		if _, err := c.callDone("delete_offer", map[string]any{"offer_id": offerID, "confirmation": token}); err != nil {
			return "", err
		}
		return "confirmé", nil
	})

	// --- A track: the file goes in two steps.
	c.step("start_upload", func() (string, error) {
		r, err := c.callOK("start_upload", map[string]any{"purpose": "track"})
		if err != nil {
			return "", err
		}
		upload = r.data
		c.rep.add(upload.text("secret"))
		c.rep.add(upload.text("command"))
		if !strings.HasPrefix(upload.text("secret"), "ptu_") || upload.text("upload_id") == "" {
			return "", errors.New("l'emplacement n'a pas d'identifiant ou de secret")
		}
		if !c.sameServer(upload.text("upload_url"), "/api/app/mcp-uploads/") {
			return "", errors.New("l'adresse d'envoi n'est pas celle de ce serveur : le lancer avec APP_URL=http://localhost:<port> (les clés d'accès refusent une adresse IP comme APP_URL)")
		}
		return fmt.Sprintf("emplacement ouvert, %d Mo au plus", int(upload.number("max_bytes"))>>20), nil
	})
	put := func(data []byte) (int, error) {
		req, err := http.NewRequestWithContext(c.ctx, http.MethodPut, upload.text("upload_url"), bytes.NewReader(data))
		if err != nil {
			return 0, err
		}
		req.Header.Set("X-Upload-Secret", upload.text("secret"))
		req.Header.Set("Content-Type", "application/octet-stream")
		response, err := c.site.Do(req)
		if err != nil {
			return 0, errors.New("l'envoi n'a pas abouti")
		}
		defer response.Body.Close()
		io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		return response.StatusCode, nil
	}
	c.step("envoi du fichier", func() (string, error) {
		status, err := put(trackGPX)
		if err != nil {
			return "", err
		}
		if status != http.StatusNoContent {
			return "", fmt.Errorf("le PUT a reçu %d, pas 204", status)
		}
		return fmt.Sprintf("204, %d octets", len(trackGPX)), nil
	})
	c.step("set_track", func() (string, error) {
		r, err := c.callDone("set_track", map[string]any{"format_id": undated, "upload_id": upload.text("upload_id"), "use_track_values": true})
		if err != nil {
			return "", err
		}
		points = int(r.data.number("track", "points"))
		if want := bytes.Count(trackGPX, []byte("<trkpt")); points != want {
			return "", fmt.Errorf("la trace a %d points, le fichier en a %d", points, want)
		}
		trackURL := r.data.text("format", "track_url")
		if trackURL == "" {
			return "", errors.New("l'épreuve n'a pas d'adresse de trace")
		}
		served, err := c.fetch(trackURL)
		if err != nil {
			return "", err
		}
		if !bytes.Equal(served, trackGPX) {
			return "", errors.New("le fichier de la trace n'est pas celui qui a été envoyé")
		}
		detail, err := c.event(eventID)
		if err != nil {
			return "", err
		}
		for _, format := range detail.list("formats") {
			if format.text("id") == undated {
				if got, want := format.number("distance_km"), math.Round(r.data.number("track", "distance_km")*10)/10; math.Abs(got-want) > 0.051 {
					return "", fmt.Errorf("la distance de l'épreuve est %v km, celle de la trace %v", got, want)
				}
			}
		}
		return fmt.Sprintf("envoi en deux temps, %d points", points), nil
	})
	c.step("envoi du fichier", func() (string, error) {
		status, err := put(trackGPX)
		if err != nil {
			return "", err
		}
		if status != http.StatusBadRequest {
			return "", fmt.Errorf("un second envoi sur l'emplacement servi a reçu %d, pas 400", status)
		}
		return "l'emplacement a servi : un second envoi est refusé (400)", nil
	})

	// --- A photo, in base64 (and back as it was).
	c.step("set_photo", func() (string, error) {
		args := map[string]any{"content_base64": base64.StdEncoding.EncodeToString(photoPNG)}
		r, err := c.call("set_photo", args)
		if err != nil {
			return "", err
		}
		note := "photo posée, en base64"
		if err := r.ok(); err == nil && !r.data.flag("done") {
			// The runner has a photo already: the site asks before it replaces it.
			hadPhoto = true
			if r, _, err = c.confirmed("set_photo", args); err != nil {
				return "", err
			}
			note = "photo remplacée après confirmation"
		}
		if err := r.done(); err != nil {
			return "", err
		}
		if r.data.text("runner", "photo_url") == "" {
			return "", errors.New("le coureur n'a pas de photo après l'appel")
		}
		return note, nil
	})
	if !hadPhoto {
		// Put back: there was no photo before.
		c.step("set_photo", func() (string, error) {
			r, _, err := c.confirmed("set_photo", map[string]any{"remove": true})
			if err != nil {
				return "", err
			}
			if r.data.text("runner", "photo_url") != "" {
				return "", errors.New("la photo est encore là")
			}
			return "photo retirée après confirmation", nil
		})
	}

	// --- A format that moves, which asks when somebody is on it, and one that goes.
	c.step("update_format", func() (string, error) {
		r, err := c.call("update_format", map[string]any{"format_id": dated, "date": c.day(32)})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return fmt.Sprintf("confirmation demandée (%s est inscrit·e à l'épreuve)", c.me), nil
	})
	c.step("update_format", func() (string, error) {
		if _, err := c.callDone("update_format", map[string]any{"format_id": dated, "date": c.day(32), "confirmation": token}); err != nil {
			return "", err
		}
		detail, err := c.event(eventID)
		if err != nil {
			return "", err
		}
		if detail.text("end_date") != c.day(32) {
			return "", fmt.Errorf("la course finit le %s, pas le %s : sa fin ne suit pas l'épreuve", detail.text("end_date"), c.day(32))
		}
		return "jour déplacé, la fin de la course suit (" + c.day(32) + ")", nil
	})
	c.step("delete_format", func() (string, error) {
		r, err := c.call("delete_format", map[string]any{"format_id": undated})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("delete_format", func() (string, error) {
		if _, err := c.callDone("delete_format", map[string]any{"format_id": undated, "confirmation": token}); err != nil {
			return "", err
		}
		detail, err := c.event(eventID)
		if err != nil {
			return "", err
		}
		if formats := detail.list("formats"); len(formats) != 1 || formats[0].text("id") != dated {
			return "", errors.New("la course n'a pas gardé que l'épreuve datée")
		}
		return "confirmé, il reste l'épreuve datée", nil
	})

	// --- The settings.
	c.step("calendar_link", func() (string, error) {
		r, err := c.callDone("calendar_link", map[string]any{"action": "show"})
		if err != nil {
			return "", err
		}
		exists, known := r.data.at("exists").(bool)
		if !known {
			return "", errors.New("la réponse ne dit pas si la personne a un lien d'agenda")
		}
		c.rep.add(r.data.text("url"))
		if exists {
			return "lien d'agenda présent (non montré)", nil
		}
		return "pas de lien d'agenda", nil
	})
	c.step("passkeys", func() (string, error) {
		r, err := c.callDone("passkeys", map[string]any{"action": "list"})
		if err != nil {
			return "", err
		}
		if !r.data.isList("passkeys") || r.data.text("runner", "name") != c.me {
			return "", errors.New("la réponse n'est pas la liste des clés de la personne")
		}
		return plural(len(r.data.list("passkeys")), "clé d'accès", "clés d'accès"), nil
	})
	c.memberTokens(&secondToken)

	// --- The race goes, with everything it holds.
	c.step("delete_event", func() (string, error) {
		r, err := c.call("delete_event", map[string]any{"event_id": eventID})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("delete_event", func() (string, error) {
		r, err := c.callDone("delete_event", map[string]any{"event_id": eventID, "confirmation": token})
		if err != nil {
			return "", err
		}
		if r.data.text("removed", "id") != eventID {
			return "", errors.New("ce n'est pas la course demandée qui est supprimée")
		}
		if gone, err := c.call("get_event", map[string]any{"event_id": eventID}); err != nil || gone.ok() == nil {
			return "", errors.New("la course supprimée se lit encore")
		}
		n, err := c.countEvents(raceName)
		if err != nil {
			return "", err
		}
		if n != before {
			return "", fmt.Errorf("%d courses « %s » au lieu de %d", n, raceName, before)
		}
		return "confirmé", nil
	})
}

// sameServer says that an address is a path of this very server: on this machine, on
// the port of the MCP address. Its host may be another name for the machine: the
// site takes localhost for APP_URL (a passkey wants a domain, not 127.0.0.1) while
// the check may address 127.0.0.1.
func (c *checker) sameServer(address, prefix string) bool {
	u, err := serverURL(address)
	mine, _ := serverURL(c.mcpURL)
	return err == nil && mine != nil && isLocal(u) && u.Scheme == mine.Scheme && u.Port() == mine.Port() && strings.HasPrefix(u.Path, prefix)
}

// fetch reads a file of the site, which anybody can (no token goes with it).
func (c *checker) fetch(address string) ([]byte, error) {
	req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	response, err := c.site.Do(req)
	if err != nil {
		return nil, errors.New("le fichier ne se lit pas")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("le fichier se lit avec le statut %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, 16<<20))
}

// memberTokens is the step of the tokens: the list marks the current one and, when
// the run signed in, a second token, made through the routes of the site, is
// revoked through the tool: it asks first, and the next call that token makes
// is refused.
func (c *checker) memberTokens(second *madeToken) {
	c.step("mcp_tokens", func() (string, error) {
		if c.session != "" {
			made, err := c.newToken(tokenName + "-2")
			if err != nil {
				return "", err
			}
			*second = made
		}
		r, err := c.callDone("mcp_tokens", map[string]any{"action": "list"})
		if err != nil {
			return "", err
		}
		tokens := r.data.list("tokens")
		current := ""
		for _, token := range tokens {
			if token.flag("current") {
				if current != "" {
					return "", errors.New("la liste marque deux jetons comme le jeton courant")
				}
				current = token.text("id")
			}
		}
		switch {
		case current == "":
			return "", errors.New("la liste ne marque aucun jeton comme le jeton courant")
		case c.tokenID != "" && current != c.tokenID:
			return "", errors.New("le jeton marqué courant n'est pas celui du client")
		case second.ID != "" && len(tokens) < 2:
			return "", errors.New("la liste ne montre pas le second jeton")
		}
		return plural(len(tokens), "jeton", "jetons") + ", le courant est marqué", nil
	})
	if second.ID == "" {
		return
	}
	var token string
	c.step("mcp_tokens", func() (string, error) {
		status, err := c.rawStatus(second.Token)
		if err != nil {
			return "", err
		}
		if status != http.StatusOK {
			return "", fmt.Errorf("le second jeton reçoit %d, pas 200", status)
		}
		r, err := c.call("mcp_tokens", map[string]any{"action": "revoke", "token_id": second.ID})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "révoquer un jeton demande une confirmation", nil
	})
	c.step("mcp_tokens", func() (string, error) {
		r, err := c.callDone("mcp_tokens", map[string]any{"action": "revoke", "token_id": second.ID, "confirmation": token})
		if err != nil {
			return "", err
		}
		if r.data.text("revoked", "id") != second.ID || r.data.flag("revoked", "current") {
			return "", errors.New("ce n'est pas l'autre jeton qui est révoqué")
		}
		status, err := c.rawStatus(second.Token)
		if err != nil {
			return "", err
		}
		if status != http.StatusUnauthorized {
			return "", fmt.Errorf("le jeton révoqué reçoit %d, pas 401", status)
		}
		return "autre jeton révoqué, aussitôt refusé (401)", nil
	})
}

// ---------------------------------------------------------------------------
// Writing, as an admin

func (c *checker) adminSteps() {
	var (
		token          string
		first, second  string
		before         int
		detailsPreview []string
	)

	c.step("admin_list_members", func() (string, error) {
		r, err := c.callOK("admin_list_members", nil)
		if err != nil {
			return "", err
		}
		if err := noEmail(r); err != nil {
			return "", err
		}
		members := r.data.list("members")
		if len(members) == 0 {
			return "", errors.New("le site n'a aucun coureur")
		}
		return plural(len(members), "coureur", "coureurs"), nil
	})

	c.step("admin_create_runner", func() (string, error) {
		r, err := c.callDone("admin_create_runner", map[string]any{"name": testName})
		if err != nil {
			return "", err
		}
		if r.data.text("runner", "name") != testName || len(r.data.text("runner", "id")) != 15 {
			return "", errors.New("le coureur n'a pas le nom demandé")
		}
		return "« " + testName + " »", nil
	})

	// An invitation is always asked: the link opens an account to whoever has it.
	c.step("admin_create_link", func() (string, error) {
		r, _, err := c.confirmed("admin_create_link", map[string]any{"runner": testName, "kind": "invite"})
		if err != nil {
			return "", err
		}
		link := r.data.text("url")
		c.rep.add(link)
		parsed, err := url.Parse(link)
		if err != nil || parsed.Path != "/invitation" || parsed.Fragment == "" || parsed.Scheme+"://"+parsed.Host != c.appURL {
			return "", errors.New("le lien n'est pas une adresse d'invitation du site")
		}
		expires, err := time.Parse(time.RFC3339, r.data.text("expires_at"))
		if err != nil {
			return "", errors.New("le lien n'a pas de date d'expiration")
		}
		if left := time.Until(expires); left < 6*24*time.Hour || left > 8*24*time.Hour {
			return "", fmt.Errorf("le lien vaut %s, pas 7 jours", left.Round(time.Hour))
		}
		return "confirmé, lien reçu, expire le " + expires.UTC().Format(time.DateOnly), nil
	})
	c.step("admin_revoke_link", func() (string, error) {
		r, err := c.call("admin_revoke_link", map[string]any{"runner": testName, "kind": "invite"})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("admin_revoke_link", func() (string, error) {
		r, err := c.callDone("admin_revoke_link", map[string]any{"runner": testName, "kind": "invite", "confirmation": token})
		if err != nil {
			return "", err
		}
		if r.data.text("revoked", "kind") != "invite" {
			return "", errors.New("ce n'est pas l'invitation qui est révoquée")
		}
		return "confirmé", nil
	})

	c.step("admin_create_race_type", func() (string, error) {
		r, err := c.callDone("admin_create_race_type", map[string]any{"label": testName})
		if err != nil {
			return "", err
		}
		if r.data.text("race_type", "label") != testName {
			return "", errors.New("le type n'a pas le nom demandé")
		}
		return "« " + testName + " »", nil
	})
	c.step("admin_delete_race_type", func() (string, error) {
		r, err := c.call("admin_delete_race_type", map[string]any{"race_type": testName})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("admin_delete_race_type", func() (string, error) {
		if _, err := c.callDone("admin_delete_race_type", map[string]any{"race_type": testName, "confirmation": token}); err != nil {
			return "", err
		}
		return "confirmé", nil
	})

	// --- Two races that are the same one: the second is a likely duplicate, which
	// the person confirms; the admin merges them, and the one that is left goes too.
	doubled := c.racePayload(duplicateName, "Lyon", 45, false)
	c.step("create_event", func() (string, error) {
		n, err := c.countEvents(duplicateName)
		if err != nil {
			return "", err
		}
		before = n
		r, err := c.callDone("create_event", doubled)
		if err != nil {
			return "", err
		}
		first = r.data.text("id")
		again, err := c.call("create_event", doubled)
		if err != nil {
			return "", err
		}
		confirmation, err := c.asked(again)
		if err != nil {
			return "", err
		}
		made, err := c.callDone("create_event", with(doubled, confirmation))
		if err != nil {
			return "", err
		}
		second = made.data.text("id")
		if len(first) != 15 || len(second) != 15 || first == second {
			return "", errors.New("les deux courses n'ont pas deux identifiants")
		}
		return "« " + duplicateName + " » deux fois (le doublon confirmé)", nil
	})
	c.step("admin_merge", func() (string, error) {
		args := map[string]any{"kind": "events", "keep_id": first, "merge_id": second}
		preview, err := c.call("admin_merge", args)
		if err != nil {
			return "", err
		}
		if token, err = c.asked(preview); err != nil {
			return "", err
		}
		if detailsPreview = preview.data.texts("confirmation", "details"); len(detailsPreview) == 0 {
			return "", errors.New("l'aperçu ne dit rien de ce que la fusion ferait")
		}
		merged, err := c.callDone("admin_merge", with(args, token))
		if err != nil {
			return "", err
		}
		if merged.data.text("kept", "id") != first || int(merged.data.number("result", "movedFormats")) != 1 {
			return "", errors.New("la fusion n'a pas gardé la première course, ou n'a pas déplacé son épreuve")
		}
		n, err := c.countEvents(duplicateName)
		if err != nil {
			return "", err
		}
		if n != before+1 {
			return "", fmt.Errorf("%d courses « %s » après la fusion, pas %d", n, duplicateName, before+1)
		}
		return "aperçu, puis fusion", nil
	})
	c.step("delete_event", func() (string, error) {
		_, _, err := c.confirmed("delete_event", map[string]any{"event_id": first})
		if err != nil {
			return "", err
		}
		n, err := c.countEvents(duplicateName)
		if err != nil {
			return "", err
		}
		if n != before {
			return "", fmt.Errorf("%d courses « %s » au lieu de %d", n, duplicateName, before)
		}
		return "« " + duplicateName + " » enlevée", nil
	})

	c.step("admin_delete_runner", func() (string, error) {
		r, err := c.call("admin_delete_runner", map[string]any{"runner": testName})
		if err != nil {
			return "", err
		}
		if token, err = c.asked(r); err != nil {
			return "", err
		}
		return "confirmation demandée", nil
	})
	c.step("admin_delete_runner", func() (string, error) {
		r, err := c.callDone("admin_delete_runner", map[string]any{"runner": testName, "confirmation": token})
		if err != nil {
			return "", err
		}
		if r.data.text("removed", "name") != testName {
			return "", errors.New("ce n'est pas le coureur d'essai qui est supprimé")
		}
		return "confirmé", nil
	})
}
