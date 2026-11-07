package mcp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// clientAddress is the address of the client of the requests below, as a
// proxy that the site trusts reports it.
const clientAddress = "198.51.100.9"

// inside runs body during a request to the application, as a tool does: with
// the in-process API on the router of that request, and a function that gives
// the context of a call made for a user.
func inside(t *testing.T, app *tests.TestApp, body func(t testing.TB, inner *mcp.InnerAPI, as func(user *core.Record) context.Context)) {
	t.Helper()
	(&tests.ApiScenario{
		Method:         http.MethodGet,
		URL:            "/test/inner",
		ExpectedStatus: http.StatusNoContent,
		BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, e *core.ServeEvent) {
			inner := mcp.NewInnerAPI(e.Router)
			e.Router.GET("/test/inner", func(re *core.RequestEvent) error {
				as := func(user *core.Record) context.Context {
					c := mcp.NewCaller(user, nil, re.Request.Host, re.Request.RemoteAddr, http.Header{"X-Forwarded-For": {clientAddress}})
					return mcp.WithCaller(re.Request.Context(), c)
				}
				body(t, inner, as)
				return re.NoContent(http.StatusNoContent)
			})
		},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// Each request goes through the API of the site, as the caller: the rules
// decide, and the request hooks set who did it.
func TestInner_RunsTheRulesAndHooks(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	counted := mcp.CountInnerRequests(t)

	type participation struct {
		ID        string `json:"id"`
		AddedBy   string `json:"added_by"`
		Confirmed bool   `json:"confirmed"`
	}
	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		const participations = "/api/collections/participations/records"

		// Sam is on F15 already, and has no account.
		var sam participation
		err := inner.Send(as(fx.Alice), http.MethodPost, participations,
			map[string]any{"runner": fx.SamRunner.Id, "format": fx.FLyon.Id, "status": "interested"}, &sam)
		if err != nil {
			t.Fatalf("Alice adds Sam: %v", err)
		}
		if sam.AddedBy != fx.AliceRunner.Id || sam.Confirmed {
			t.Errorf("Sam, added by Alice: added_by %q, confirmed %v; want Alice's runner, not confirmed", sam.AddedBy, sam.Confirmed)
		}

		var alice participation
		err = inner.Send(as(fx.Alice), http.MethodPost, participations,
			map[string]any{"runner": fx.AliceRunner.Id, "format": fx.FLyon.Id, "status": "interested"}, &alice)
		if err != nil {
			t.Fatalf("Alice adds herself: %v", err)
		}
		if alice.AddedBy != fx.AliceRunner.Id || !alice.Confirmed {
			t.Errorf("Alice, added by herself: added_by %q, confirmed %v; want hers, confirmed", alice.AddedBy, alice.Confirmed)
		}

		// The rule of an update: Bob cannot change Alice's confirmed one.
		err = inner.Send(as(fx.Bob), http.MethodPatch, participations+"/"+fx.P1.Id, map[string]any{"status": "dns"}, nil)
		var refused *mcp.APIError
		if !errors.As(err, &refused) || refused.Status != http.StatusNotFound {
			t.Errorf("Bob changes Alice's confirmed participation: %v, want the API's 404", err)
		}

		// The creator of an event is the caller, whatever the body says.
		var event struct {
			CreatedBy string `json:"created_by"`
		}
		err = inner.Send(as(fx.Alice), http.MethodPost, "/api/collections/events/records", map[string]any{
			"name": "Trail d'essai", "location": "Annecy", "start_date": "2026-09-12", "created_by": fx.BobRunner.Id,
		}, &event)
		if err != nil {
			t.Fatalf("Alice creates an event: %v", err)
		}
		if event.CreatedBy != fx.AliceRunner.Id {
			t.Errorf("the event is created by %q, want Alice's runner", event.CreatedBy)
		}

		// A file, as the site sends it: multipart.
		var runner struct {
			Avatar string `json:"avatar"`
		}
		err = inner.SendForm(as(fx.Alice), http.MethodPatch, "/api/collections/runners/records/"+fx.AliceRunner.Id, nil,
			[]mcp.FormFile{{Field: "avatar", Name: "alice.png", ContentType: "image/png", Data: testutil.PNG(t, 40, 40)}}, &runner)
		if err != nil {
			t.Fatalf("Alice sets her photo: %v", err)
		}
		if runner.Avatar == "" {
			t.Error("the answer has no photo")
		}
	})

	stored, err := app.FindRecordById("runners", fx.AliceRunner.Id)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("avatar") == "" {
		t.Error("Alice's runner has no photo in the database")
	}
	if got := counted.Of(http.MethodPost); got != 3 {
		t.Errorf("%d inner POST, want 3", got)
	}
	if got := counted.Of(http.MethodPatch); got != 2 {
		t.Errorf("%d inner PATCH, want 2", got)
	}
}

// The limits and the log of the site see the client, not the server itself.
func TestInner_ForwardsTheClientAddress(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	type seen struct {
		ip, userAgent, auth, other string
	}
	var got seen
	app.OnRecordsListRequest("runners").BindFunc(func(e *core.RecordsListRequestEvent) error {
		got = seen{ip: e.RealIP(), userAgent: e.Request.UserAgent(), other: e.Request.Header.Get("X-Other")}
		if e.Auth != nil {
			got.auth = e.Auth.Id
		}
		return e.Next()
	})
	want := seen{ip: clientAddress, userAgent: "prends-ton-dossard-mcp", auth: fx.Alice.Id}

	t.Run("the in-process API", func(t *testing.T) {
		got = seen{}
		inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
			if err := inner.Get(as(fx.Alice), "/api/collections/runners/records?perPage=1", nil); err != nil {
				t.Fatal(err)
			}
		})
		if got != want {
			t.Errorf("the inner request was seen as %+v, want %+v", got, want)
		}
	})

	t.Run("a tool", func(t *testing.T) {
		got = seen{}
		token := newToken(t, app, fx.Alice)
		send(t, app, http.MethodPost, bearer(token), map[string]string{
			"MCP-Protocol-Version": protocolVersion,
			"X-Forwarded-For":      clientAddress,
			// Only the headers of the trusted proxy go in.
			"X-Other": "from the client",
		}, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}`, http.StatusOK)
		if got != want {
			t.Errorf("the inner request of whoami was seen as %+v, want %+v", got, want)
		}
	})
}

// A refusal of the API is an *APIError with what describe needs: the status,
// the method, the code, the code of each field, and the request of a batch.
func TestInner_Refusals(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	refusal := func(t testing.TB, err error) *mcp.APIError {
		t.Helper()
		var refused *mcp.APIError
		if !errors.As(err, &refused) {
			t.Fatalf("got %v, want a refusal of the API", err)
		}
		return refused
	}
	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		// The validation of a record.
		got := refusal(t, inner.Send(as(fx.Alice), http.MethodPost, "/api/collections/events/records", map[string]any{"location": "Annecy"}, nil))
		if got.Status != http.StatusBadRequest || got.Method != http.MethodPost || got.Request != -1 ||
			got.Fields["name"] != "validation_required" || got.Fields["start_date"] != "validation_required" {
			t.Errorf("an event without a name: %+v", got)
		}

		// The code of a hook.
		got = refusal(t, inner.Send(as(fx.Admin), http.MethodDelete, "/api/collections/race_types/records/"+fx.Trail.Id, nil, nil))
		if got.Status != http.StatusBadRequest || got.Code != "race_type_in_use" || len(got.Fields) != 0 {
			t.Errorf("a race type in use: %+v", got)
		}

		// A read of what is not there.
		got = refusal(t, inner.Get(as(fx.Alice), "/api/collections/events/records/"+strings.Repeat("a", 15), nil))
		if got.Status != http.StatusNotFound || got.Method != http.MethodGet {
			t.Errorf("an event that does not exist: %+v", got)
		}

		// A batch says which of its requests failed, and why.
		got = refusal(t, inner.Send(as(fx.Alice), http.MethodPost, "/api/batch", map[string]any{"requests": []map[string]any{
			{"method": "POST", "url": "/api/collections/events/records", "body": map[string]any{"name": "Trail d'essai", "location": "Annecy", "start_date": "2026-09-12"}},
			{"method": "POST", "url": "/api/collections/formats/records", "body": map[string]any{"event": fx.Event.Id, "race_type": fx.Trail.Id, "distance_km": 10, "price_eur": 12.345}},
		}}, nil))
		if got.Status != http.StatusBadRequest || got.Request != 1 || got.Fields["price_eur"] != "price_invalid" {
			t.Errorf("a batch whose second request fails: %+v", got)
		}

		// The status is the one of the request that failed, not the batch's.
		got = refusal(t, inner.Send(as(fx.Bob), http.MethodPost, "/api/batch", map[string]any{"requests": []map[string]any{
			{"method": "PATCH", "url": "/api/collections/participations/records/" + fx.P1.Id, "body": map[string]any{"status": "dns"}},
		}}, nil))
		if got.Status != http.StatusNotFound || got.Request != 0 || got.Method != http.MethodPost {
			t.Errorf("a batch that changes somebody else's confirmed participation: %+v", got)
		}
	})

	// The batch is one transaction: its first request is not written either.
	if events, err := app.FindAllRecords("events", dbx.HashExp{"name": "Trail d'essai"}); err != nil || len(events) != 0 {
		t.Errorf("the event of the failed batch is there: %d (%v)", len(events), err)
	}
}

// A batch is checked request by request against the same list: it is not a
// second way in. What is sent is what was checked.
func TestInner_BatchRequestsAreChecked(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	counted := mcp.CountInnerRequests(t)

	event := map[string]any{"name": "Trail d'essai", "location": "Annecy", "start_date": "2026-09-12"}
	request := func(method, url string, body any) map[string]any {
		return map[string]any{"method": method, "url": url, "body": body}
	}
	batch := func(requests ...map[string]any) map[string]any {
		return map[string]any{"requests": requests}
	}
	const events = "/api/collections/events/records"

	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		for _, row := range []struct {
			name string
			body any
		}{
			{"a collection that is not in the list", batch(request(http.MethodPost, events, event), request(http.MethodPost, "/api/collections/mcp_tokens/records", map[string]any{"name": "x"}))},
			{"an upsert", batch(request(http.MethodPut, events, event))},
			{"a method in lower case", batch(request("post", events, event))},
			{"a batch in a batch", batch(request(http.MethodPost, "/api/batch", batch(request(http.MethodPost, events, event))))},
			{"a route of the admin, for a member", batch(request(http.MethodPost, "/api/collections/race_types/records", map[string]any{"label": "Essai"}))},
			{"an id that is not one", batch(request(http.MethodPatch, events+"/x", event))},
			{"headers of its own", batch(map[string]any{"method": http.MethodPost, "url": events, "body": event, "headers": map[string]any{"X-Forwarded-For": "203.0.113.1"}})},
			{"two urls that differ by case", map[string]any{"requests": []any{json.RawMessage(`{"method":"POST","url":"/api/collections/events/records","URL":"/api/collections/mcp_tokens/records","body":{}}`)}}},
			{"no request", batch()},
			{"no body", nil},
		} {
			if err := inner.Send(as(fx.Alice), http.MethodPost, "/api/batch", row.body, nil); err == nil || errors.As(err, new(*mcp.APIError)) {
				t.Errorf("%s: %v, want a refusal before the API", row.name, err)
			}
		}
		// A batch is never a form: its requests could not be read.
		if err := inner.SendForm(as(fx.Alice), http.MethodPost, "/api/batch", map[string]string{"@jsonPayload": `{"requests":[]}`}, nil, nil); err == nil {
			t.Error("a batch was sent as a form")
		}
		if got := counted.Total(); got != 0 {
			t.Errorf("%d inner requests were sent, want none", got)
		}

		// A batch of the list goes, as it was checked.
		var answer []struct {
			Status int `json:"status"`
		}
		if err := inner.Send(as(fx.Alice), http.MethodPost, "/api/batch", batch(request(http.MethodPost, events, event)), &answer); err != nil {
			t.Fatalf("a batch of the list: %v", err)
		}
		if len(answer) != 1 || answer[0].Status != http.StatusOK {
			t.Errorf("a batch of the list answers %+v", answer)
		}
	})
	if events, err := app.FindAllRecords("events", dbx.HashExp{"name": "Trail d'essai"}); err != nil || len(events) != 1 {
		t.Errorf("%d events made by the batch (%v), want 1", len(events), err)
	}
	if tokens, err := app.FindAllRecords("mcp_tokens", dbx.HashExp{"user": fx.Alice.Id}); err != nil || len(tokens) != 0 {
		t.Errorf("Alice has %d tokens (%v), want none", len(tokens), err)
	}
}

// The routes of the admin tools are refused to a member's call before the API,
// whose rules refuse them too: a mistake of the wiring is not enough to open
// one (spec § 6.3).
func TestInner_AdminRoutesNeedAnAdmin(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	counted := mcp.CountInnerRequests(t)

	routes := []struct {
		method, path string
		body         any
	}{
		{http.MethodPatch, "/api/collections/users/records/" + fx.Bob.Id, map[string]any{}},
		{http.MethodGet, "/api/collections/invitations/records", nil},
		{http.MethodPost, "/api/collections/runners/records", map[string]any{"name": "Julie"}},
		{http.MethodDelete, "/api/collections/runners/records/" + fx.SamRunner.Id, nil},
		{http.MethodPost, "/api/collections/race_types/records", map[string]any{"label": "Essai"}},
		{http.MethodPatch, "/api/collections/race_types/records/" + fx.Trail.Id, map[string]any{}},
		{http.MethodDelete, "/api/collections/race_types/records/" + fx.Backyard.Id, nil},
		{http.MethodPost, "/api/app/invitations", map[string]any{}},
		{http.MethodDelete, "/api/app/invitations/" + strings.Repeat("a", 15), nil},
		{http.MethodPost, "/api/app/admin/merge-events", map[string]any{}},
		{http.MethodPost, "/api/app/admin/merge-formats", map[string]any{}},
	}
	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		for _, r := range routes {
			if _, _, err := inner.Do(as(fx.Alice), r.method, r.path, r.body); err == nil {
				t.Errorf("a member's call sent %s %s", r.method, r.path)
			}
		}
		if got := counted.Total(); got != 0 {
			t.Fatalf("a member's calls sent %d requests, want none", got)
		}

		// An admin's reach the API, which decides.
		for _, r := range routes {
			if _, _, err := inner.Do(as(fx.Admin), r.method, r.path, r.body); err != nil {
				t.Errorf("an admin's call of %s %s was not sent: %v", r.method, r.path, err)
			}
		}
		if got := counted.Total(); got != len(routes) {
			t.Errorf("an admin's calls sent %d requests, want %d", got, len(routes))
		}

		// A route of every token is a member's too.
		if err := inner.Get(as(fx.Alice), "/api/collections/race_types/records", nil); err != nil {
			t.Errorf("a member reads the race types: %v", err)
		}
	})
}

// The name of a file is escaped as mime/multipart escapes it, line breaks
// included, and a media type with a control character is refused: neither can
// add a header to the part.
func TestInner_FormHeaders(t *testing.T) {
	for _, name := range []string{`trace.gpx`, `a "quoted" name`, `back\slash`, "two\r\nlines: x", "piste é.gpx"} {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		if _, err := form.CreateFormFile("gpx", name); err != nil {
			t.Fatal(err)
		}
		want := fmt.Sprintf(`form-data; name="gpx"; filename="%s"`, mcp.QuoteEscape(name))
		if !strings.Contains(body.String(), "Content-Disposition: "+want+"\r\n") {
			t.Errorf("%q: mime/multipart writes %q, the package %q", name, body.String(), want)
		}
	}

	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	counted := mcp.CountInnerRequests(t)
	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		for _, contentType := range []string{"image/png\r\nX-Injected: 1", "image/png\n", "image/\x00png"} {
			err := inner.SendForm(as(fx.Alice), http.MethodPatch, "/api/collections/runners/records/"+fx.AliceRunner.Id, nil,
				[]mcp.FormFile{{Field: "avatar", Name: "alice.png", ContentType: contentType, Data: testutil.PNG(t, 4, 4)}}, nil)
			if err == nil {
				t.Errorf("the media type %q was sent", contentType)
			}
		}
	})
	if got := counted.Total(); got != 0 {
		t.Errorf("%d inner requests were sent, want none", got)
	}
}

// No tool proxies a path: the in-process API sends only the requests of its
// list. Above all, it never makes an MCP token, whose secret would go through
// the assistant, although the session of an inner request opens the routes of
// the tokens.
func TestInner_CannotCreateAToken(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	counted := mcp.CountInnerRequests(t)

	body := map[string]any{"name": "Fait par l'assistant"}
	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		for _, row := range []struct{ method, path string }{
			{http.MethodPost, "/api/app/mcp-tokens"},
			{http.MethodPost, "/api/app/mcp-tokens/"},
			{http.MethodPost, "/api/app/mcp-tokens?name=x"},
			{"post", "/api/app/mcp-tokens"},
			{http.MethodPost, "//api/app/mcp-tokens"},
			{http.MethodPost, "http://localhost/api/app/mcp-tokens"},
			{http.MethodPost, "/api/collections/comments/records/../../../app/mcp-tokens"},
			{http.MethodPost, "/api/collections/comments/records/%2E%2E/%2E%2E/%2E%2E/app/mcp-tokens"},
			{http.MethodPost, "/api/collections/comments/records/..%2F..%2F..%2Fapp%2Fmcp-tokens"},
			{http.MethodPost, "/api/collections/mcp_tokens/records"},
			{http.MethodPost, "/api/app/me/email"},
			{http.MethodPost, "/api/collections/users/auth-with-password"},
			// A route of the list, with what is not an id where an id goes.
			{http.MethodPatch, "/api/collections/runners/records/not-an-id"},
			// A route of the list once decoded, which the router would read
			// otherwise: no escape in a path.
			{http.MethodGet, "/api/collections/runners%2Frecords"},
			{http.MethodDelete, "/api/app/mcp-tokens/" + strings.Repeat("a", 14)},
		} {
			_, _, err := inner.Do(as(fx.Alice), row.method, row.path, body)
			if err == nil {
				t.Errorf("%s %s was sent", row.method, row.path)
			}
			var refused *mcp.APIError
			if errors.As(err, &refused) {
				t.Errorf("%s %s reached the API, which answered %d", row.method, row.path, refused.Status)
			}
			err = inner.SendForm(as(fx.Alice), row.method, row.path, map[string]string{"name": "Fait par l'assistant"}, nil, nil)
			if err == nil {
				t.Errorf("%s %s was sent as a form", row.method, row.path)
			}
		}
	})

	if got := counted.Total(); got != 0 {
		t.Errorf("%d inner requests were sent, want none", got)
	}
	tokens, err := app.FindAllRecords("mcp_tokens", dbx.HashExp{"user": fx.Alice.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 0 {
		t.Errorf("Alice has %d tokens, want none", len(tokens))
	}
}

// The tools of the settings reach the passkeys, the calendar link and the tokens
// by the routes that they need, with the methods that they need, and no others:
// no passkey is made (WebAuthn needs the device), no token (its secret would go
// through the assistant), the feed of a calendar is not read, and the tables that
// only the routes of the site read (the links of the calendar, the tokens) have no
// route of their own. A member's call and an admin's are alike here.
func TestInner_SettingsRoutes(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	counted := mcp.CountInnerRequests(t)
	id := strings.Repeat("a", 15)

	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		for _, caller := range []*core.Record{fx.Alice, fx.Admin} {
			for _, row := range []struct{ method, path string }{
				{http.MethodPost, "/api/collections/passkeys/records"},
				{http.MethodPost, "/api/app/passkeys/register/begin"},
				{http.MethodPost, "/api/app/passkeys/register/finish"},
				{http.MethodPost, "/api/app/passkeys/login/begin"},
				{http.MethodPost, "/api/app/passkeys/login/finish"},
				{http.MethodPut, "/api/collections/passkeys/records/" + id},
				{http.MethodGet, "/api/app/calendar/" + id + ".ics"},
				{http.MethodPut, "/api/app/calendar"},
				{http.MethodPatch, "/api/app/calendar"},
				{http.MethodGet, "/api/collections/calendar_feeds/records"},
				{http.MethodPost, "/api/collections/calendar_feeds/records"},
				{http.MethodDelete, "/api/collections/calendar_feeds/records/" + id},
				{http.MethodPost, "/api/app/mcp-tokens"},
				{http.MethodGet, "/api/app/mcp-tokens/" + id},
				{http.MethodPatch, "/api/app/mcp-tokens/" + id},
				{http.MethodPut, "/api/app/mcp-tokens/" + id},
				{http.MethodGet, "/api/collections/mcp_tokens/records"},
				{http.MethodPost, "/api/collections/mcp_tokens/records"},
				{http.MethodPatch, "/api/collections/mcp_tokens/records/" + id},
				{http.MethodDelete, "/api/collections/mcp_tokens/records/" + id},
				{http.MethodPatch, "/api/app/me/reminders"},
				{http.MethodPost, "/api/app/me/reminders"},
				{http.MethodDelete, "/api/app/me/reminders"},
				{http.MethodPost, "/api/app/push/test"},
				{http.MethodPost, "/api/app/push/subscriptions"},
				{http.MethodDelete, "/api/app/push/subscriptions"},
				{http.MethodDelete, "/api/app/push/subscriptions/" + id},
				{http.MethodPost, "/api/app/push/renew"},
				{http.MethodPost, "/api/app/push"},
				{http.MethodGet, "/api/collections/push_subscriptions/records"},
				{http.MethodPost, "/api/app/me/email"},
				{http.MethodPost, "/api/app/me/password"},
				{http.MethodPost, "/api/collections/runners/records/" + id + "/passkeys"},
			} {
				if _, _, err := inner.Do(as(caller), row.method, row.path, map[string]any{}); err == nil {
					t.Errorf("%s %s was sent for %s", row.method, row.path, caller.Email())
				}
			}
		}
		if got := counted.Total(); got != 0 {
			t.Fatalf("%d inner requests were sent for routes that are not in the list, want none", got)
		}

		// The routes of the tools are sent, for a member: the API decides what it
		// answers.
		var sent int
		for _, row := range []struct {
			method, path string
			body         any
		}{
			{http.MethodPatch, "/api/collections/runners/records/" + fx.AliceRunner.Id, map[string]any{"name": "Alice"}},
			{http.MethodGet, "/api/collections/passkeys/records?fields=id", nil},
			{http.MethodGet, "/api/collections/passkeys/records/" + id, nil},
			{http.MethodPatch, "/api/collections/passkeys/records/" + id, map[string]any{"name": "iPhone"}},
			{http.MethodDelete, "/api/collections/passkeys/records/" + id, nil},
			{http.MethodGet, "/api/app/calendar", nil},
			{http.MethodPost, "/api/app/calendar", map[string]any{"lang": "fr"}},
			{http.MethodDelete, "/api/app/calendar", nil},
			{http.MethodGet, "/api/app/mcp-tokens", nil},
			{http.MethodDelete, "/api/app/mcp-tokens/" + id, nil},
			{http.MethodGet, "/api/app/me/reminders", nil},
			{http.MethodPut, "/api/app/me/reminders", map[string]any{"reminders": []string{}}},
			{http.MethodGet, "/api/app/push", nil},
		} {
			if _, _, err := inner.Do(as(fx.Alice), row.method, row.path, row.body); err != nil {
				t.Errorf("%s %s was not sent: %v", row.method, row.path, err)
			}
			sent++
		}
		if got := counted.Total(); got != sent {
			t.Errorf("%d inner requests were sent, want the %d of the tools", got, sent)
		}
	})
}
