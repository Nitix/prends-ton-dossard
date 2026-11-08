package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/json/jsontext"
	jsonv2 "encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
)

// userAgent is the agent of the inner requests: the request log tells them from
// the requests of the site.
const userAgent = "prends-ton-dossard-mcp"

// sessionLifetime is the lifetime of the session of an inner request: one
// request, but a slow one (a batch, a file) must not see it expire.
const sessionLifetime = time.Minute

// innerAPI sends requests to PocketBase's own router, as the caller (spec
// § 5.1): the rules of the collections, the routes of the site, their request
// and model hooks, the batch and its transaction, the limits and the log apply
// to them as to the requests of the site.
//
// It sends only the requests of routes (see checkRoute): a tool names its path,
// and nothing that an assistant sends becomes one, but an id where the route has
// one.
type innerAPI struct {
	router *router.Router[*core.RequestEvent]
	// The handler of the router, built at the first request: by then every
	// route and middleware is there, in production (PocketBase builds its own at
	// the end of OnServe) as in tests.ApiScenario (which serves its request
	// within OnServe). Never apis.NewRouter, which would bind the hooks of the
	// realtime a second time (spec § 5.2).
	once   sync.Once
	mux    http.Handler
	muxErr error
}

// onInnerRequest, when set, is told the method of each inner request that is
// sent. The tests count the requests with it.
var onInnerRequest func(method string)

// formFile is a file of a multipart request.
type formFile struct {
	Field, Name, ContentType string
	Data                     []byte
}

// apiError is a refusal of the API: its status, the method of the request that
// it refused (a 404 does not say the same for a read and a write) and its path
// (without the query, for the log), its code, the code of each field, and, for
// a batch, the index of the request that failed (-1 otherwise).
type apiError struct {
	Status  int
	Method  string
	Path    string
	Code    string
	Fields  map[string]string
	Request int
}

func (e *apiError) Error() string {
	var details []string
	if e.Code != "" {
		details = append(details, "code "+e.Code)
	}
	for _, field := range slices.Sorted(maps.Keys(e.Fields)) {
		details = append(details, field+" "+e.Fields[field])
	}
	if e.Request >= 0 {
		details = append(details, "request "+strconv.Itoa(e.Request))
	}
	return fmt.Sprintf("mcp: the API refused a %s with %d (%s)", e.Method, e.Status, strings.Join(details, ", "))
}

// do sends a request with body as its JSON (none when nil), and returns the
// status and the body of the answer. An error is a request that could not be
// sent: an answer, whatever its status, is not one.
func (a *innerAPI) do(ctx context.Context, method, path string, body any) (status int, data []byte, err error) {
	c, err := callerOf(ctx)
	if err != nil {
		return 0, nil, err
	}
	if err := checkRoute(c.role, method, path); err != nil {
		return 0, nil, err
	}
	var encoded []byte
	if body != nil {
		if encoded, err = json.Marshal(body); err != nil {
			return 0, nil, fmt.Errorf("mcp: encoding the body of %s %s: %w", method, pathOf(path), err)
		}
	}
	if pathOf(path) == batchPath {
		if encoded, err = checkBatch(c.role, encoded); err != nil {
			return 0, nil, err
		}
	}
	var reader io.Reader
	contentType := ""
	if encoded != nil {
		reader, contentType = bytes.NewReader(encoded), "application/json"
	}
	return a.serve(ctx, c, method, path, reader, contentType)
}

// get reads path into out: a 2xx answer is decoded, any other is an *apiError.
func (a *innerAPI) get(ctx context.Context, path string, out any) error {
	return a.send(ctx, http.MethodGet, path, nil, out)
}

// send sends body as JSON, and decodes a 2xx answer into out (nothing when nil);
// any other answer is an *apiError.
func (a *innerAPI) send(ctx context.Context, method, path string, body, out any) error {
	status, data, err := a.do(ctx, method, path, body)
	if err != nil {
		return err
	}
	return decode(method, path, status, data, out)
}

// sendForm sends a multipart/form-data body, as the site's SDK does for a new
// file: fields and files. Removing a file is a JSON request ({"avatar": null},
// {"gpx": null}), as the site does.
//
// A batch is never a form: the requests of its form could not be checked.
func (a *innerAPI) sendForm(ctx context.Context, method, path string, fields map[string]string, files []formFile, out any) error {
	c, err := callerOf(ctx)
	if err != nil {
		return err
	}
	if err := checkRoute(c.role, method, path); err != nil {
		return err
	}
	if pathOf(path) == batchPath {
		return fmt.Errorf("%w: a batch as a form", errRoute)
	}
	for _, file := range files {
		// The media type goes in a header of the part, as it is: a line break
		// would add one.
		if strings.ContainsFunc(file.ContentType, unicode.IsControl) {
			return fmt.Errorf("mcp: the media type of the file %s holds a control character", file.Field)
		}
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for _, name := range slices.Sorted(maps.Keys(fields)) {
		if err := form.WriteField(name, fields[name]); err != nil {
			return fmt.Errorf("mcp: writing the form of %s %s: %w", method, pathOf(path), err)
		}
	}
	for _, file := range files {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, quoteEscaper.Replace(file.Field), quoteEscaper.Replace(file.Name)))
		header.Set("Content-Type", file.ContentType)
		part, err := form.CreatePart(header)
		if err == nil {
			_, err = part.Write(file.Data)
		}
		if err != nil {
			return fmt.Errorf("mcp: writing the form of %s %s: %w", method, pathOf(path), err)
		}
	}
	if err := form.Close(); err != nil {
		return fmt.Errorf("mcp: writing the form of %s %s: %w", method, pathOf(path), err)
	}

	status, data, err := a.serve(ctx, c, method, path, &body, form.FormDataContentType())
	if err != nil {
		return err
	}
	return decode(method, path, status, data, out)
}

// quoteEscaper escapes a name in a Content-Disposition, as mime/multipart does:
// the quotes, and the line breaks, which would end the header.
var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"", "\r", "%0D", "\n", "%0A")

// serve sends the request through the router, as the caller, and returns the
// answer.
//
// The request carries a session of the caller that lives a minute, made here
// for it: it is never logged, returned, or put in an error, and does not leave
// the process. Of the request of the assistant, it carries only what says where
// it came from (its host, its address, the headers of the trusted proxy): never
// its Authorization.
func (a *innerAPI) serve(ctx context.Context, c *caller, method, path string, body io.Reader, contentType string) (int, []byte, error) {
	a.once.Do(func() { a.mux, a.muxErr = a.router.BuildMux() })
	if a.muxErr != nil {
		return 0, nil, fmt.Errorf("mcp: building the router: %w", a.muxErr)
	}

	session, err := c.user.NewStaticAuthToken(sessionLifetime)
	if err != nil {
		return 0, nil, fmt.Errorf("mcp: making the session of an inner request: %w", err)
	}
	// A request that a server receives always has a body, which the router of
	// PocketBase wraps: an empty one when there is none.
	if body == nil {
		body = http.NoBody
	}
	req, err := http.NewRequestWithContext(ctx, method, path, body)
	if err != nil {
		return 0, nil, fmt.Errorf("mcp: making the request %s %s: %w", method, pathOf(path), err)
	}
	req.RequestURI = req.URL.RequestURI()
	req.Host = c.host
	req.RemoteAddr = c.remoteAddr
	for name, values := range c.forwarded {
		req.Header[http.CanonicalHeaderKey(name)] = slices.Clone(values)
	}
	req.Header.Set("Authorization", session)
	req.Header.Set("User-Agent", userAgent)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	if onInnerRequest != nil {
		onInnerRequest(method)
	}
	recorder := httptest.NewRecorder()
	a.mux.ServeHTTP(recorder, req)
	if req.MultipartForm != nil {
		_ = req.MultipartForm.RemoveAll()
	}
	return recorder.Code, recorder.Body.Bytes(), nil
}

// decode decodes a 2xx answer into out (nothing when out is nil), and makes an
// *apiError of any other.
func decode(method, path string, status int, data []byte, out any) error {
	if status < 200 || status > 299 {
		e := parseAPIError(method, status, data)
		e.Path = pathOf(path)
		return e
	}
	if out == nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("mcp: reading the answer of %s %s: %w", method, pathOf(path), err)
	}
	return nil
}

// parseAPIError reads the body of a refusal of the API: data.code (a route or
// a hook of the site), data.<field>.code (the validation of a record), or
// data.requests.<i>.response (a request of a batch that failed, which is read
// the same way). A body that cannot be read is a refusal with its status only.
func parseAPIError(method string, status int, data []byte) *apiError {
	e := &apiError{Status: status, Method: method, Request: -1}
	var body struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &body) != nil {
		return e
	}

	var requests map[string]struct {
		Response struct {
			Status int                        `json:"status"`
			Data   map[string]json.RawMessage `json:"data"`
		} `json:"response"`
	}
	if raw, ok := body.Data["requests"]; ok && json.Unmarshal(raw, &requests) == nil && len(requests) > 0 {
		for key, failed := range requests {
			index, err := strconv.Atoi(key)
			if err != nil {
				continue
			}
			e.Request = index
			if failed.Response.Status != 0 {
				e.Status = failed.Response.Status
			}
			readCodes(e, failed.Response.Data)
			return e
		}
	}
	readCodes(e, body.Data)
	return e
}

// readCodes reads data.code and data.<field>.code into e.
func readCodes(e *apiError, data map[string]json.RawMessage) {
	for key, raw := range data {
		if key == "code" {
			_ = json.Unmarshal(raw, &e.Code)
			continue
		}
		var field struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(raw, &field) == nil && field.Code != "" {
			if e.Fields == nil {
				e.Fields = map[string]string{}
			}
			e.Fields[key] = field.Code
		}
	}
}

// pathOf is path without its query, for the messages: a query can be long.
func pathOf(path string) string {
	p, _, _ := strings.Cut(path, "?")
	return p
}

// ---------------------------------------------------------------------------
// The requests that the tools may send

// The records that the tools read and write, and what they do with each
// collection's: list (GET …/records), view (GET …/records/{id}), create (POST
// …/records), update (PATCH …/records/{id}), delete (DELETE …/records/{id}).
// The rules of each collection decide what the caller may do; these lists only
// keep the in-process API from sending anything else.
const (
	recordList   = "list"
	recordView   = "view"
	recordCreate = "create"
	recordUpdate = "update"
	recordDelete = "delete"
)

// memberRecords are what the tools of every token do with the records of each
// collection (spec § 6.3). A member tool that an admin uses on every record
// (the photo, the name, the passkeys) is one of them.
var memberRecords = map[string][]string{
	// The races, their formats, the participations, the comments, the rides
	// and lodgings (spec § 6.4 to 6.8).
	"events":         {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"formats":        {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"participations": {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"comments":       {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"offers":         {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"offer_members":  {recordList, recordView, recordCreate, recordDelete},
	"race_types":     {recordList, recordView},
	// The runners: the reads, the photo and the name (§ 6.9, 6.10).
	"runners": {recordList, recordView, recordUpdate},
	// The passkeys of the settings (§ 6.10): never made here (WebAuthn needs
	// the device).
	"passkeys": {recordList, recordView, recordUpdate, recordDelete},
}

// adminRecords are what only the admin tools do (spec § 6.11): the call of a
// member cannot send them, whatever the wiring, and the rules of the site
// refuse them to a member besides.
var adminRecords = map[string][]string{
	// admin_create_race_type, admin_update_race_type, admin_delete_race_type.
	"race_types": {recordCreate, recordUpdate, recordDelete},
	// admin_create_runner, admin_delete_runner.
	"runners": {recordCreate, recordDelete},
	// admin_list_members: the pending links, without their token.
	"invitations": {recordList},
	// admin_set_role, admin_set_disabled.
	"users": {recordUpdate},
}

// batchPath is the batch of PocketBase: its requests are checked one by one
// (checkBatch).
const batchPath = "/api/batch"

// memberRoutes are the routes of the site, besides the records, that the tools
// of every token send requests to. {id} stands for the id of a record.
//
// Never POST /api/app/mcp-tokens: a token does not make a token, whose secret
// would go through the assistant (spec § 10). The session of an inner request
// would open that route: this list is what keeps it shut.
var memberRoutes = []string{
	// create_event, update_event: the event, its formats and a participation,
	// in one transaction, as the form of the site.
	"POST " + batchPath,
	// calendar_link.
	"GET /api/app/calendar",
	"POST /api/app/calendar",
	"DELETE /api/app/calendar",
	// mcp_tokens: the list, and a revocation.
	"GET /api/app/mcp-tokens",
	"DELETE /api/app/mcp-tokens/{id}",
	// reminders: the choice of the person, read and replaced.
	"GET /api/app/me/reminders",
	"PUT /api/app/me/reminders",
	// reminders: the devices that receive the notifications, counted and named.
	"GET /api/app/push",
	// get_weather: the weather of the days of a race.
	"GET /api/app/events/{id}/weather",
}

// adminRoutes are the routes that only the admin tools send requests to.
var adminRoutes = []string{
	// admin_create_link, admin_revoke_link.
	"POST /api/app/invitations",
	"DELETE /api/app/invitations/{id}",
	// admin_merge.
	"POST /api/app/admin/merge-events",
	"POST /api/app/admin/merge-formats",
}

// route is a method and the segments of a path, where "{id}" matches an id,
// and the role that may send it: an admin sends the routes of a member too.
type route struct {
	method   string
	segments []string
	role     role
}

// routes are the requests that the in-process API may send.
var routes = func() []route {
	var all []route
	add := func(r role, method, path string) {
		all = append(all, route{method: method, segments: strings.Split(strings.TrimPrefix(path, "/"), "/"), role: r})
	}
	for r, records := range map[role]map[string][]string{roleMember: memberRecords, roleAdmin: adminRecords} {
		for collection, actions := range records {
			path := "/api/collections/" + collection + "/records"
			for _, action := range actions {
				switch action {
				case recordList:
					add(r, http.MethodGet, path)
				case recordView:
					add(r, http.MethodGet, path+"/{id}")
				case recordCreate:
					add(r, http.MethodPost, path)
				case recordUpdate:
					add(r, http.MethodPatch, path+"/{id}")
				case recordDelete:
					add(r, http.MethodDelete, path+"/{id}")
				default:
					panic("mcp: unknown action " + action + " on " + collection)
				}
			}
		}
	}
	for r, list := range map[role][]string{roleMember: memberRoutes, roleAdmin: adminRoutes} {
		for _, line := range list {
			method, path, ok := strings.Cut(line, " ")
			if !ok {
				panic("mcp: a route without a method: " + line)
			}
			add(r, method, path)
		}
	}
	return all
}()

// idPattern is the form of the id of a record (core.DefaultIdAlphabet,
// core.DefaultIdLength).
var idPattern = regexp.MustCompile(`^[a-z0-9]{15}$`)

// isID reports whether s has the form of the id of a record: the only kind of
// value, with a day, that may go into a path or a filter of an inner request.
func isID(s string) bool {
	return idPattern.MatchString(s)
}

// errRoute is the refusal of a request that is not one of routes.
var errRoute = errors.New("mcp: a request that the tools may not send")

// checkRoute refuses a request that is not one of routes for a caller of that
// role: path is a path and a query, never an address, written only in the plain
// characters of a route and of an id (no dot segment, no escape), and its path
// is one of the method.
func checkRoute(r role, method, path string) error {
	refuse := func() error {
		return fmt.Errorf("%w: %s %s", errRoute, method, pathOf(path))
	}
	u, err := url.Parse(path)
	if err != nil || u.Scheme != "" || u.Host != "" || u.Opaque != "" || u.User != nil ||
		u.Fragment != "" || strings.Contains(path, "#") || u.EscapedPath() != u.Path || !strings.HasPrefix(u.Path, "/") {
		return refuse()
	}
	segments := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	for _, allowed := range routes {
		if allowed.role <= r && allowed.method == method && allowed.matches(segments) {
			return nil
		}
	}
	return refuse()
}

// batchRequest is a request of a batch, as PocketBase reads it
// (core.InternalRequest), without the headers of its own that it may carry:
// a tool sends none.
type batchRequest struct {
	Method string         `json:"method"`
	URL    string         `json:"url"`
	Body   jsontext.Value `json:"body,omitzero"`
}

// checkBatch checks each request of the body of a batch as checkRoute checks a
// request: a batch is not a second way in. It returns the body to send, written
// again from what it checked, so that what PocketBase reads is what was
// checked. It reads the body strictly: names in their exact case, once each,
// and nothing else (no headers of a request, which would be sent as they are).
// A batch in a batch, or a batch without a request, is refused.
func checkBatch(r role, body []byte) ([]byte, error) {
	var batch struct {
		Requests []batchRequest `json:"requests"`
	}
	if err := jsonv2.Unmarshal(body, &batch, jsonv2.RejectUnknownMembers(true)); err != nil {
		return nil, fmt.Errorf("%w: a batch that cannot be read: %v", errRoute, err)
	}
	if len(batch.Requests) == 0 {
		return nil, fmt.Errorf("%w: a batch without a request", errRoute)
	}
	for i, request := range batch.Requests {
		if pathOf(request.URL) == batchPath {
			return nil, fmt.Errorf("%w: a batch in request %d of a batch", errRoute, i)
		}
		if err := checkRoute(r, request.Method, request.URL); err != nil {
			return nil, fmt.Errorf("%w (request %d of a batch)", err, i)
		}
	}
	return jsonv2.Marshal(batch)
}

// matches reports whether the segments of a path are the ones of the route.
func (r route) matches(segments []string) bool {
	if len(segments) != len(r.segments) {
		return false
	}
	for i, want := range r.segments {
		if want == "{id}" {
			if !isID(segments[i]) {
				return false
			}
		} else if segments[i] != want {
			return false
		}
	}
	return true
}
