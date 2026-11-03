package mcp

import (
	"bytes"
	"context"
	"encoding/json"
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
// it refused (a 404 does not say the same for a read and a write), its code,
// the code of each field, and, for a batch, the index of the request that
// failed (-1 otherwise).
type apiError struct {
	Status  int
	Method  string
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
	if err := checkRoute(method, path); err != nil {
		return 0, nil, err
	}
	var reader io.Reader
	contentType := ""
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("mcp: encoding the body of %s %s: %w", method, pathOf(path), err)
		}
		reader, contentType = bytes.NewReader(encoded), "application/json"
	}
	return a.serve(ctx, method, path, reader, contentType)
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
func (a *innerAPI) sendForm(ctx context.Context, method, path string, fields map[string]string, files []formFile, out any) error {
	if err := checkRoute(method, path); err != nil {
		return err
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

	status, data, err := a.serve(ctx, method, path, &body, form.FormDataContentType())
	if err != nil {
		return err
	}
	return decode(method, path, status, data, out)
}

// quoteEscaper escapes a name in a Content-Disposition, as mime/multipart does.
var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"")

// serve sends the request through the router, as the caller, and returns the
// answer.
//
// The request carries a session of the caller that lives a minute, made here
// for it: it is never logged, returned, or put in an error, and does not leave
// the process. Of the request of the assistant, it carries only what says where
// it came from (its host, its address, the headers of the trusted proxy): never
// its Authorization.
func (a *innerAPI) serve(ctx context.Context, method, path string, body io.Reader, contentType string) (int, []byte, error) {
	c, err := callerOf(ctx)
	if err != nil {
		return 0, nil, err
	}
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
		return parseAPIError(method, status, data)
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
// The rules of each collection decide what the caller may do; this list only
// keeps the in-process API from sending anything else.
const (
	recordList   = "list"
	recordView   = "view"
	recordCreate = "create"
	recordUpdate = "update"
	recordDelete = "delete"
)

var collectionRoutes = map[string][]string{
	// The races, their formats, the participations, the comments, the rides
	// and lodgings (spec § 6.4 to 6.9), and the race types (§ 6.11).
	"events":         {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"formats":        {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"participations": {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"comments":       {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"offers":         {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	"offer_members":  {recordList, recordView, recordCreate, recordDelete},
	"race_types":     {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	// The runners: the reads, the photo and the name (§ 6.9, 6.10), and the
	// runners without an account of the admin (§ 6.11).
	"runners": {recordList, recordView, recordCreate, recordUpdate, recordDelete},
	// The passkeys of the settings (§ 6.10): never made here (WebAuthn needs
	// the device).
	"passkeys": {recordList, recordView, recordUpdate, recordDelete},
	// The pending links of the members page (§ 6.11), without their token.
	"invitations": {recordList},
	// The role and the disabling of an account (§ 6.11).
	"users": {recordUpdate},
}

// otherRoutes are the routes of the site, besides the records, that the tools
// send requests to. {id} stands for the id of a record.
//
// Never POST /api/app/mcp-tokens: a token does not make a token, whose secret
// would go through the assistant (spec § 10). The session of an inner request
// would open that route: this list is what keeps it shut.
var otherRoutes = []string{
	// create_event, update_event: the event, its formats and a participation,
	// in one transaction, as the form of the site.
	"POST /api/batch",
	// calendar_link.
	"GET /api/app/calendar",
	"POST /api/app/calendar",
	"DELETE /api/app/calendar",
	// mcp_tokens: the list, and a revocation.
	"GET /api/app/mcp-tokens",
	"DELETE /api/app/mcp-tokens/{id}",
	// admin_create_link, admin_revoke_link.
	"POST /api/app/invitations",
	"DELETE /api/app/invitations/{id}",
	// admin_merge.
	"POST /api/app/admin/merge-events",
	"POST /api/app/admin/merge-formats",
}

// route is a method and the segments of a path, where "{id}" matches an id.
type route struct {
	method   string
	segments []string
}

// routes are the requests that the in-process API may send.
var routes = func() []route {
	var all []route
	add := func(method, path string) {
		all = append(all, route{method: method, segments: strings.Split(strings.TrimPrefix(path, "/"), "/")})
	}
	for collection, actions := range collectionRoutes {
		records := "/api/collections/" + collection + "/records"
		for _, action := range actions {
			switch action {
			case recordList:
				add(http.MethodGet, records)
			case recordView:
				add(http.MethodGet, records+"/{id}")
			case recordCreate:
				add(http.MethodPost, records)
			case recordUpdate:
				add(http.MethodPatch, records+"/{id}")
			case recordDelete:
				add(http.MethodDelete, records+"/{id}")
			default:
				panic("mcp: unknown action " + action + " on " + collection)
			}
		}
	}
	for _, r := range otherRoutes {
		method, path, ok := strings.Cut(r, " ")
		if !ok {
			panic("mcp: a route without a method: " + r)
		}
		add(method, path)
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

// checkRoute refuses a request that is not one of routes: path is a path and a
// query, never an address, written only in the plain characters of a route and
// of an id (no dot segment, no escape), and its path is one of the method.
func checkRoute(method, path string) error {
	refuse := func() error {
		return fmt.Errorf("%w: %s %s", errRoute, method, pathOf(path))
	}
	u, err := url.Parse(path)
	if err != nil || u.Scheme != "" || u.Host != "" || u.Opaque != "" || u.User != nil ||
		u.Fragment != "" || strings.Contains(path, "#") || u.EscapedPath() != u.Path || !strings.HasPrefix(u.Path, "/") {
		return refuse()
	}
	segments := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	for _, r := range routes {
		if r.method == method && r.matches(segments) {
			return nil
		}
	}
	return refuse()
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
