package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// The tests of the package are external ones (testutil imports the setup of
// the application, which imports this package): this file gives them what they
// need.

// SetNow makes the package read that moment, instead of the real clock, until
// the test ends: "today", the limiter of the tokens.
func SetNow(t testing.TB, at time.Time) {
	t.Helper()
	previous := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = previous })
}

// RoleOf is the role that roleOf gives the account, by its name.
func RoleOf(user *core.Record) string { return roleOf(user).String() }

// The limiter of the tokens.
type TokenLimiter = tokenLimiter

func NewTokenLimiter(now func() time.Time) *TokenLimiter { return newTokenLimiter(now) }
func (l *tokenLimiter) Allow(tokenID string) bool        { return l.allow(tokenID) }

// Len is the number of buckets that the limiter keeps.
func (l *tokenLimiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// The in-process API, and who it acts for.
type (
	InnerAPI = innerAPI
	APIError = apiError
	FormFile = formFile
	Caller   = caller
)

func NewInnerAPI(r *router.Router[*core.RequestEvent]) *InnerAPI { return &innerAPI{router: r} }

func (a *innerAPI) Do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	return a.do(ctx, method, path, body)
}
func (a *innerAPI) Get(ctx context.Context, path string, out any) error { return a.get(ctx, path, out) }
func (a *innerAPI) Send(ctx context.Context, method, path string, body, out any) error {
	return a.send(ctx, method, path, body, out)
}
func (a *innerAPI) SendForm(ctx context.Context, method, path string, fields map[string]string, files []FormFile, out any) error {
	return a.sendForm(ctx, method, path, fields, files, out)
}

// NewCaller is a caller for user, with token (nil for none), from that host
// and address, with these headers of the trusted proxy.
func NewCaller(user, token *core.Record, host, remoteAddr string, forwarded http.Header) *Caller {
	return &caller{user: user, token: token, role: roleOf(user), host: host, remoteAddr: remoteAddr, forwarded: forwarded}
}

func WithCaller(ctx context.Context, c *Caller) context.Context { return withCaller(ctx, c) }

// InnerRequests counts the inner requests by method.
type InnerRequests struct {
	mu       sync.Mutex
	byMethod map[string]int
}

// CountInnerRequests counts the inner requests sent until the test ends: a
// call that must write nothing sends no POST, PATCH or DELETE.
func CountInnerRequests(t testing.TB) *InnerRequests {
	t.Helper()
	counted := &InnerRequests{byMethod: map[string]int{}}
	previous := onInnerRequest
	onInnerRequest = func(method string) {
		counted.mu.Lock()
		defer counted.mu.Unlock()
		counted.byMethod[method]++
	}
	t.Cleanup(func() { onInnerRequest = previous })
	return counted
}

// Of is the number of inner requests of that method.
func (c *InnerRequests) Of(method string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.byMethod[method]
}

// Total is the number of inner requests.
func (c *InnerRequests) Total() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	total := 0
	for _, n := range c.byMethod {
		total += n
	}
	return total
}

// The messages of the tools.
func Describe(app core.App, err error, subject func(request int) string) error {
	return describe(app, err, subject)
}

// Messages are the messages of the codes, by code.
func Messages() map[string]string { return maps.Clone(messages) }

// FieldMessages are the messages of the codes that a field says in its own
// words, by field and code.
func FieldMessages() map[string]map[string]string {
	out := map[string]map[string]string{}
	for field, byCode := range fieldMessages {
		out[field] = maps.Clone(byCode)
	}
	return out
}

// RecoverPanics runs handler as the handler of a request of that method,
// within the middleware that recovers a panic, and returns what it answers.
func RecoverPanics(app core.App, method string, handler func()) (mcpsdk.Result, error) {
	next := func(context.Context, string, mcpsdk.Request) (mcpsdk.Result, error) {
		handler()
		return nil, nil
	}
	return recoverPanics(app)(next)(context.Background(), method, nil)
}

// AddMemberTool adds to the member tools, until the test ends, a tool name that
// runs handler and answers an empty object.
func AddMemberTool(t testing.TB, name string, handler func()) {
	t.Helper()
	previous := memberTools
	memberTools = append(slices.Clone(memberTools), func(s *mcpsdk.Server, _ *tools) {
		mcpsdk.AddTool(s, &mcpsdk.Tool{Name: name}, func(context.Context, *mcpsdk.CallToolRequest, struct{}) (*mcpsdk.CallToolResult, struct{}, error) {
			handler()
			return nil, struct{}{}, nil
		})
	})
	t.Cleanup(func() { memberTools = previous })
}

// WireAdminToolsForMembers puts the admin tools on the server of the members too,
// until the test ends: the wiring mistake that requireAdmin is there for.
func WireAdminToolsForMembers(t testing.TB) {
	t.Helper()
	previous := memberTools
	memberTools = append(slices.Clone(memberTools), adminTools...)
	t.Cleanup(func() { memberTools = previous })
}

// NoteCalls notes the calls of these tools in a caller, and returns the tools
// that its request log names, and how many more it was called.
func NoteCalls(names ...string) (logged []string, more int) {
	c := &caller{}
	for _, name := range names {
		c.called(name)
	}
	for _, call := range c.loggedCalls() {
		logged = append(logged, call.Tool)
	}
	return logged, c.more
}

// QuoteEscape is how a name is written in the Content-Disposition of a part.
func QuoteEscape(s string) string { return quoteEscaper.Replace(s) }

// InputSchema is inputSchema.
func InputSchema[T any](enums map[string][]string) *jsonschema.Schema { return inputSchema[T](enums) }

// The runners and the race types, as the reads have them, and how a name or an
// id is resolved to one.
type (
	RunnerRecord   = runnerRecord
	RaceTypeRecord = raceTypeRecord
)

func ResolveRunner(all []RunnerRecord, idOrName, me string) (RunnerRecord, error) {
	return resolveRunner(all, idOrName, me)
}

func ResolveRaceType(all []RaceTypeRecord, idOrName string) (RaceTypeRecord, error) {
	return resolveRaceType(all, idOrName)
}

// SetMaxEventsRead makes a search read at most n races of a period, until the
// test ends.
func SetMaxEventsRead(t testing.TB, n int) {
	t.Helper()
	previous := maxEventsRead
	maxEventsRead = n
	t.Cleanup(func() { maxEventsRead = previous })
}

// SetMaxRecords makes a read take at most n records, until the test ends.
func SetMaxRecords(t testing.TB, n int) {
	t.Helper()
	previous := maxRecords
	maxRecords = n
	t.Cleanup(func() { maxRecords = previous })
}

// TooMany is the error of a read that found more records of a collection than its
// limit.
func TooMany(collection string, limit int) error {
	return &tooManyError{Collection: collection, Limit: limit}
}

// The records the API sends, with the fields that the ports are given.
type (
	ParticipationRecord = participationRecord
	EventRecord         = eventRecord
	FormatRecord        = formatRecord
)

// The rows of the home page and of the statistics, and the blocks that the ports
// of the site's functions make of them (home.go, stats.go).
type (
	ParticipationRow = participationRow
	ResultRow        = resultRow
	RegistrationTodo = registrationTodo
	Totals           = totals
	RunnerTotals     = runnerTotals
	YearTotals       = yearTotals
)

// ResultsWindowDays is RESULTS_WINDOW_DAYS of the site.
const ResultsWindowDays = resultsWindowDays

func PendingOf(rows []ParticipationRow, today string) []ParticipationRow {
	return pendingOf(rows, today)
}
func TodosOf(rows []ParticipationRow, today string) []RegistrationTodo { return todosOf(rows, today) }
func ToEnterOf(rows []ParticipationRow, today string) []ParticipationRow {
	return toEnterOf(rows, today)
}
func IsResultToEnter(status, day, today string) bool { return isResultToEnter(status, day, today) }
func UpcomingOf(rows []ParticipationRow, today string) []ParticipationRow {
	return upcomingOf(rows, today)
}
func Excerpt(body string, max int) string                { return excerpt(body, max) }
func TotalsOf(rows []ResultRow) Totals                   { return totalsOf(rows) }
func ByRunner(rows []ResultRow, year int) []RunnerTotals { return byRunner(rows, year) }
func ByYear(rows []ResultRow) []YearTotals               { return byYear(rows) }

// NewResultRow is toResultRow of the site: a participation of the answer to a
// request made with the expand of the statistics.
func NewResultRow(record ParticipationRecord) (ResultRow, error) { return newResultRow(record) }

// The store of the confirmations, with the binding of a confirmation spelled out.
type Confirmations = confirmations

func NewConfirmations(now func() time.Time) *Confirmations { return newConfirmations(now) }

func (s *confirmations) Put(userID, tokenID, tool, args, state string) (string, time.Time) {
	token, expires, _ := s.put(pendingConfirmation{userID: userID, tokenID: tokenID, tool: tool, args: args, state: state})
	return token, expires
}

func (s *confirmations) Take(token, userID, tokenID, tool, args, state string) string {
	return s.take(token, pendingConfirmation{userID: userID, tokenID: tokenID, tool: tool, args: args, state: state})
}

// Len is the number of confirmations that wait.
func (s *confirmations) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}

// The form of the site, in Go (plan.go), and the words of a likely duplicate.
type (
	EventDraft  = eventDraft
	FormatDraft = formatDraft
	JoinDraft   = joinDraft
	StoredEvent = storedEvent
	BatchOp     = batchOp
)

func PlanBatch(draft EventDraft, stored *StoredEvent, myRunnerID string) ([]BatchOp, string, []string) {
	return planBatch(draft, stored, myRunnerID)
}
func EventEndDate(start string, formatDates []string, monthOnly bool) string {
	return eventEndDate(start, formatDates, monthOnly)
}
func IsLongEvent(start, end string) bool               { return isLongEvent(start, end) }
func Shortens(storedStart, storedEnd, end string) bool { return shortens(storedStart, storedEnd, end) }
func HasMeasure(f FormatDraft) bool                    { return hasMeasure(f) }
func SignificantWords(name string) []string            { return significantWords(name) }

// Duplicates are the ids of the likely duplicates of a race, as create_event
// looks for them, for the caller of ctx.
func Duplicates(ctx context.Context, app core.App, inner *InnerAPI, name, start, exceptID string) ([]string, error) {
	t := &tools{deps: &deps{app: app, inner: inner}}
	found, err := t.duplicates(ctx, name, start, exceptID)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, event := range found {
		ids = append(ids, event.ID)
	}
	return ids, nil
}

// ParseFinishTime is parseFinishTime: a time of a result, "h:mm:ss", in seconds.
func ParseFinishTime(s string) (int, error) { return parseFinishTime(s) }

// The reading of a GPX track (gpx.go).
type (
	TrackPoint = trackPoint
	GpxStats   = gpxStats
)

const HysteresisM = hysteresisM

func ParseGpx(xml []byte) ([]TrackPoint, error) { return parseGpx(xml) }
func StatsOf(points []TrackPoint) GpxStats      { return statsOf(points) }
func WithXmlDeclaration(data []byte) []byte     { return withXmlDeclaration(data) }

// The store of the upload slots (uploads.go), with the purpose spelled out.
type Uploads = uploads

const (
	UploadTotal    = uploadTotal
	PhotoMaxBytes  = photoMaxBytes
	TrackMaxBytes  = trackMaxBytes
	InlineMaxBytes = inlineMaxBytes
)

var (
	ErrUploadInvalid  = errUploadInvalid
	ErrUploadEmpty    = errUploadEmpty
	ErrUploadTooLarge = errUploadTooLarge
)

func NewUploads(now func() time.Time) *Uploads { return newUploads(now) }

func (u *uploads) Open(userID, tokenID, purpose string) (id, secret string, expires time.Time) {
	return u.open(userID, tokenID, uploadPurpose(purpose))
}

func (u *uploads) Put(id, secret string, size int64, body io.Reader) error {
	return u.put(context.Background(), id, secret, size, body)
}

// PutContext is Put for a request whose context is ctx.
func (u *uploads) PutContext(ctx context.Context, id, secret string, size int64, body io.Reader) error {
	return u.put(ctx, id, secret, size, body)
}

func (u *uploads) Peek(id, tokenID, purpose string) ([]byte, string, error) {
	file, err := u.peek(id, tokenID, uploadPurpose(purpose))
	return file.data, file.contentType, err
}

func (u *uploads) Take(id, tokenID, purpose string) ([]byte, string, error) {
	file, err := u.take(id, tokenID, uploadPurpose(purpose))
	return file.data, file.contentType, err
}

// Len is the number of slots that the store keeps.
func (u *uploads) Len() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.slots)
}

// Bytes is the number of bytes that the store keeps, or keeps room for.
func (u *uploads) Bytes() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.bytes
}

// OfName is ofName: « de » before a name, elided as French does.
func OfName(name string) string { return ofName(name) }

// The admin tools (admin_*.go).

// adminHandlers are the handlers of the admin tools, by name, each reading its
// arguments from their JSON.
var adminHandlers = map[string]func(*tools, context.Context, []byte) error{
	"admin_list_members":     handlerOf((*tools).adminListMembers),
	"admin_create_runner":    handlerOf((*tools).adminCreateRunner),
	"admin_delete_runner":    handlerOf((*tools).adminDeleteRunner),
	"admin_create_link":      handlerOf((*tools).adminCreateLink),
	"admin_revoke_link":      handlerOf((*tools).adminRevokeLink),
	"admin_set_role":         handlerOf((*tools).adminSetRole),
	"admin_set_disabled":     handlerOf((*tools).adminSetDisabled),
	"admin_create_race_type": handlerOf((*tools).adminCreateRaceType),
	"admin_update_race_type": handlerOf((*tools).adminUpdateRaceType),
	"admin_delete_race_type": handlerOf((*tools).adminDeleteRaceType),
	"admin_merge":            handlerOf((*tools).adminMerge),
}

// handlerOf calls a handler with the arguments that a JSON gives, and returns
// its error as the handler returns it.
func handlerOf[In, Out any](handler func(*tools, context.Context, *mcpsdk.CallToolRequest, In) (*mcpsdk.CallToolResult, Out, error)) func(*tools, context.Context, []byte) error {
	return func(t *tools, ctx context.Context, args []byte) error {
		var in In
		if err := json.Unmarshal(args, &in); err != nil {
			return err
		}
		_, _, err := handler(t, ctx, &mcpsdk.CallToolRequest{}, in)
		return err
	}
}

// AdminToolNames are the names of the admin tools that CallAdminTool knows, in
// order.
func AdminToolNames() []string { return slices.Sorted(maps.Keys(adminHandlers)) }

// CallAdminTool calls the handler of the admin tool name directly, with args,
// for the caller of ctx (whom no server chose), and returns its error as the
// handler returns it.
func CallAdminTool(ctx context.Context, app core.App, inner *InnerAPI, name string, args map[string]any) error {
	handler, ok := adminHandlers[name]
	if !ok {
		return fmt.Errorf("no admin tool %s", name)
	}
	data, err := json.Marshal(args)
	if err != nil {
		return err
	}
	t := &tools{deps: &deps{app: app, inner: inner, confirms: newConfirmations(time.Now)}}
	return handler(t, ctx, data)
}

// The members, as admin_list_members reads them, and the port of
// features/admin/memberState.ts.
type (
	InvitationRecord = invitationRecord
	AccountRecord    = accountRecord
	MemberRunner     = memberRunner
)

// WithAccount is a runner as the members list reads it: with its account (nil
// for none).
func WithAccount(r RunnerRecord, account *AccountRecord) MemberRunner {
	m := memberRunner{runnerRecord: r}
	m.Expand.User = account
	return m
}

func MemberState(runner RunnerRecord, user *AccountRecord, pending *InvitationRecord, now time.Time) string {
	return memberState(runner, user, pending, now)
}

// Member is a member as toMembers gives it: the name of the runner, and the rest.
type Member struct {
	Runner            string
	User              *AccountRecord
	State             string
	Invitation, Reset *InvitationRecord
}

func ToMembers(runners []MemberRunner, invitations []InvitationRecord, now time.Time) []Member {
	var out []Member
	for _, m := range toMembers(runners, invitations, now) {
		out = append(out, Member{Runner: m.runner.Name, User: m.user, State: m.state, Invitation: m.invitation, Reset: m.reset})
	}
	return out
}

func ExpiryDay(expiresAt string) string { return expiryDay(expiresAt) }

// What a merge does, as the route answers it, and the port of describeMerge of
// features/admin/mergePreview.ts.
type MergeResult = mergeResult

func DescribeMerge(r MergeResult) []string { return describeMerge(r) }

// ReadTrack is readTrack: the numbers of a track, its parse bounded.
func ReadTrack(ctx context.Context, data []byte) (GpxStats, error) { return readTrack(ctx, data) }

// SetTrackParseHook makes each parse of a track call hook with its size, until the
// test ends.
func SetTrackParseHook(t testing.TB, hook func(size int)) {
	t.Helper()
	previous := onTrackParse
	onTrackParse = hook
	t.Cleanup(func() { onTrackParse = previous })
}

// PeekTrack is what the PUT of a track slot read of its file.
func (u *uploads) PeekTrack(id, tokenID string) (GpxStats, error) {
	file, err := u.peek(id, tokenID, purposeTrack)
	if err != nil {
		return GpxStats{}, err
	}
	if file.track == nil {
		return GpxStats{}, errors.New("no track read")
	}
	return *file.track, nil
}

var (
	ErrUploadBusy    = errUploadBusy
	ErrUploadTooSlow = errUploadTooSlow
)

const PutTimeout = putTimeout

// MaxInFlight is how many requests a token has under way at most.
const MaxInFlight = maxInFlight

// UploadRoute is the handler of PUT /api/app/mcp-uploads/{id}, for a store.
func UploadRoute(u *Uploads) func(*core.RequestEvent) error { return uploadRoute(u) }

// StripPhotoMetadata is stripPhotoMetadata.
func StripPhotoMetadata(contentType string, data []byte) ([]byte, error) {
	return stripPhotoMetadata(contentType, data)
}
