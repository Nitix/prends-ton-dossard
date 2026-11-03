package mcp_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The admin tools are an admin's only (spec § 6.3): a member's token does not see
// them, and calling one by its name is answered as a tool that does not exist. The
// role is the one of the account, read at each request.

// adminCalls are a call of each admin tool with arguments that it would act on,
// for the fixture.
func adminCalls(fx testutil.Fixture) map[string]map[string]any {
	return map[string]map[string]any{
		"admin_list_members":     {},
		"admin_create_runner":    {"name": "Julie"},
		"admin_delete_runner":    {"runner": "Sam"},
		"admin_create_link":      {"runner": "Sam", "kind": "invite"},
		"admin_revoke_link":      {"runner": "Sam", "kind": "invite"},
		"admin_set_role":         {"runner": "Bob", "role": "admin"},
		"admin_set_disabled":     {"runner": "Bob", "disabled": true},
		"admin_create_race_type": {"label": "Rando"},
		"admin_update_race_type": {"race_type": "Trail", "label": "Trail court"},
		"admin_delete_race_type": {"race_type": "Backyard"},
		"admin_merge":            {"kind": "events", "keep_id": fx.Event.Id, "merge_id": fx.Event2.Id},
	}
}

// listedTools are the names that tools/list gives the token, in order.
func listedTools(t *testing.T, app *tests.TestApp, token string) []string {
	t.Helper()
	_, body := rpc(t, app, bearer(token), http.StatusOK, "tools/list", nil)
	var result struct {
		Tools []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	resultOf(t, body, &result)
	var names []string
	for _, tool := range result.Tools {
		names = append(names, tool.Name)
	}
	slices.Sort(names)
	return names
}

// hasAdminTools reports whether the token lists every admin tool; it fails the
// test when it lists some of them only.
func hasAdminTools(t *testing.T, app *tests.TestApp, token string) bool {
	t.Helper()
	names := listedTools(t, app, token)
	found := 0
	for _, name := range wantAdminTools {
		if slices.Contains(names, name) {
			found++
		}
	}
	if found != 0 && found != len(wantAdminTools) {
		t.Fatalf("the token lists %d of the %d admin tools: %v", found, len(wantAdminTools), names)
	}
	return found == len(wantAdminTools)
}

// unknownTool checks that a body is the error of a tool that does not exist:
// -32602, `unknown tool "<name>"`, and no result.
func unknownTool(t *testing.T, body, name string) {
	t.Helper()
	var a struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("the answer is not JSON-RPC: %v (%.200s)", err, redact(body))
	}
	if a.Result != nil {
		t.Errorf("the answer has a result: %.300s", redact(body))
	}
	if a.Error == nil || a.Error.Code != -32602 || a.Error.Message != fmt.Sprintf("unknown tool %q", name) {
		t.Errorf("the answer is %.300s, want the error -32602 unknown tool %q", redact(body), name)
	}
}

func TestMCP_MemberDoesNotSeeTheAdminTools(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	alice := newToken(t, app, fx.Alice)
	admin := newToken(t, app, fx.Admin)
	// What a call by name would act on: a pending invitation for Sam to revoke.
	linkWaiting(t, app, fx.SamRunner, "invite", "member")

	t.Run("tools/list", func(t *testing.T) {
		names := listedTools(t, app, alice)
		if want := slices.Sorted(slices.Values(wantMemberTools)); !slices.Equal(names, want) {
			t.Errorf("Alice's tools are %v, want %v", names, want)
		}
		for _, name := range names {
			if strings.HasPrefix(name, "admin_") {
				t.Errorf("Alice's tools have %s", name)
			}
		}
		want := slices.Sorted(slices.Values(append(slices.Clone(wantMemberTools), wantAdminTools...)))
		if names := listedTools(t, app, admin); !slices.Equal(names, want) {
			t.Errorf("the admin's tools are %v, want %v", names, want)
		}
	})

	// The answer to a tool that does not exist, which an admin tool's must be, but
	// for its name.
	_, unknown := rpc(t, app, bearer(alice), http.StatusOK, "tools/call", map[string]any{"name": "no_such_tool", "arguments": map[string]any{}})
	unknownTool(t, unknown, "no_such_tool")

	calls := adminCalls(fx)
	if len(calls) != len(wantAdminTools) {
		t.Fatalf("%d calls for %d admin tools", len(calls), len(wantAdminTools))
	}
	for _, name := range wantAdminTools {
		t.Run(name, func(t *testing.T) {
			args, ok := calls[name]
			if !ok {
				t.Fatalf("no call of %s", name)
			}
			before := dbState(t, app)
			counted := mcp.CountInnerRequests(t)

			_, body := rpc(t, app, bearer(alice), http.StatusOK, "tools/call", map[string]any{"name": name, "arguments": args})
			unknownTool(t, body, name)
			if got := strings.ReplaceAll(body, name, "no_such_tool"); got != unknown {
				t.Errorf("the answer to %s is\n%s\nwant, but for the name,\n%s", name, redact(body), redact(unknown))
			}
			if got := counted.Total(); got != 0 {
				t.Errorf("%d inner requests, want none", got)
			}
			if after := dbState(t, app); after != before {
				t.Errorf("the database changed:\nbefore\n%s\nafter\n%s", before, after)
			}
		})
	}
}

// The role is read on the account at each request: an admin set to member loses
// the admin tools at the next request of the same token, and gets them back when
// set back; a member made an admin gets them at the next one.
func TestMCP_RoleChangesAtTheNextRequest(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	admin := newToken(t, app, fx.Admin)
	bob := newToken(t, app, fx.Bob)

	if !hasAdminTools(t, app, admin) {
		t.Fatal("the admin's token does not list the admin tools")
	}

	// Another admin, so that the first one may be set to member.
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	second := core.NewRecord(users)
	second.Set("email", "second@example.test")
	second.Set("password", testutil.Password)
	second.Set("role", "admin")
	if err := app.Save(second); err != nil {
		t.Fatal(err)
	}

	update(t, app, fx.Admin, map[string]any{"role": "member"})
	if hasAdminTools(t, app, admin) {
		t.Error("the token of an admin set to member still lists the admin tools")
	}
	_, body := rpc(t, app, bearer(admin), http.StatusOK, "tools/call", map[string]any{
		"name": "admin_merge", "arguments": map[string]any{"kind": "events", "keep_id": fx.Event.Id, "merge_id": fx.Event2.Id},
	})
	unknownTool(t, body, "admin_merge")

	update(t, app, fx.Admin, map[string]any{"role": "admin"})
	if !hasAdminTools(t, app, admin) {
		t.Error("the token of an admin set back to admin does not list the admin tools")
	}

	if hasAdminTools(t, app, bob) {
		t.Fatal("Bob, a member, lists the admin tools")
	}
	update(t, app, fx.Bob, map[string]any{"role": "admin"})
	if !hasAdminTools(t, app, bob) {
		t.Error("Bob, made an admin, does not list the admin tools at the next request")
	}
}

// Each admin tool checks the role itself, before anything: called for a member, as
// a mistake of the wiring would, it answers the error of a tool that does not
// exist, as it is (the SDK knows a JSON-RPC error by its type), and sends nothing.
func TestTools_AdminToolsCheckTheRole(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	calls := adminCalls(fx)
	if names := mcp.AdminToolNames(); !slices.Equal(names, slices.Sorted(slices.Values(wantAdminTools))) {
		t.Fatalf("the handlers of the admin tools are %v, want %v", names, wantAdminTools)
	}

	inside(t, app, func(t testing.TB, inner *mcp.InnerAPI, as func(*core.Record) context.Context) {
		counted := mcp.CountInnerRequests(t)
		for _, name := range wantAdminTools {
			err := mcp.CallAdminTool(as(fx.Alice), app, inner, name, calls[name])
			wire, ok := err.(*jsonrpc.Error)
			if !ok {
				t.Errorf("%s for a member: the error %#v, want a JSON-RPC error as it is", name, err)
				continue
			}
			if wire.Code != jsonrpc.CodeInvalidParams || wire.Message != fmt.Sprintf("unknown tool %q", name) {
				t.Errorf("%s for a member: %d %q, want -32602 unknown tool %q", name, wire.Code, wire.Message, name)
			}
		}
		if got := counted.Total(); got != 0 {
			t.Fatalf("the calls of a member sent %d inner requests, want none", got)
		}

		// The same handlers act for an admin: what is checked above is the role.
		for _, name := range wantAdminTools {
			before := counted.Total()
			err := mcp.CallAdminTool(as(fx.Admin), app, inner, name, calls[name])
			if _, ok := err.(*jsonrpc.Error); ok {
				t.Errorf("%s for an admin: %v", name, err)
			}
			if counted.Total() == before {
				t.Errorf("%s for an admin sent no inner request", name)
			}
		}
	})
}
