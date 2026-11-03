package mcp_test

import (
	"fmt"
	"regexp"
	"testing"
	"time"

	"courses/server/mcp"
)

// tokenShape is the form of a confirmation token: cfm_ and the 26 characters of
// crypto/rand.Text (spec § 6.13).
var tokenShape = regexp.MustCompile(`^cfm_[A-Z2-7]{26}$`)

// The store of the confirmations, with a clock of its own: what fits, what is
// refused and why, and how many wait.
func TestConfirmations_Store(t *testing.T) {
	start := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	clock := start
	store := mcp.NewConfirmations(func() time.Time { return clock })

	// One binding: the account, the MCP token, the tool, the arguments and the
	// state shown.
	type binding struct{ user, token, tool, args, state string }
	alice := binding{"alice", "tokenA", "delete_format", "args", "state"}
	put := func(b binding) (string, time.Time) {
		t.Helper()
		return store.Put(b.user, b.token, b.tool, b.args, b.state)
	}
	take := func(token string, b binding) string {
		t.Helper()
		return store.Take(token, b.user, b.token, b.tool, b.args, b.state)
	}

	t.Run("the shape of a token, and its expiry", func(t *testing.T) {
		token, expires := put(alice)
		if !tokenShape.MatchString(token) {
			t.Errorf("the token %s does not have the shape cfm_ + 26 characters", prefix(token))
		}
		if want := clock.Add(10 * time.Minute); !expires.Equal(want) {
			t.Errorf("expires at %v, want %v", expires, want)
		}
		other, _ := put(alice)
		if other == token {
			t.Error("two confirmations have the same token")
		}
	})

	t.Run("the same binding fits once", func(t *testing.T) {
		token, _ := put(alice)
		if got := take(token, alice); got != "" {
			t.Fatalf("the same binding is refused: %q", got)
		}
		if got := take(token, alice); got != "used" {
			t.Errorf("a token taken twice: %q, want used", got)
		}
	})

	t.Run("expired after 10 minutes", func(t *testing.T) {
		token, _ := put(alice)
		clock = start.Add(10*time.Minute + time.Second)
		defer func() { clock = start }()
		if got := take(token, alice); got != "expired" {
			t.Errorf("a token taken after 10 min 1 s: %q, want expired", got)
		}
		// Past its time, it is not kept as spent either: refused, as unknown.
		if got := take(token, alice); got == "" {
			t.Error("an expired token fits the second time")
		}
	})

	t.Run("still good at 9 min 59 s", func(t *testing.T) {
		token, _ := put(alice)
		clock = start.Add(10*time.Minute - time.Second)
		defer func() { clock = start }()
		if got := take(token, alice); got != "" {
			t.Errorf("a token taken after 9 min 59 s: %q, want it to fit", got)
		}
	})

	for _, row := range []struct {
		name string
		with binding
		want string
	}{
		{"another account", binding{"bob", "tokenA", "delete_format", "args", "state"}, "other"},
		{"another MCP token", binding{"alice", "tokenB", "delete_format", "args", "state"}, "other"},
		{"another tool", binding{"alice", "tokenA", "delete_event", "args", "state"}, "other"},
		{"other arguments", binding{"alice", "tokenA", "delete_format", "other args", "state"}, "other"},
		{"another state", binding{"alice", "tokenA", "delete_format", "args", "new state"}, "changed"},
	} {
		t.Run(row.name, func(t *testing.T) {
			token, _ := put(alice)
			if got := take(token, row.with); got != row.want {
				t.Errorf("taken with %s: %q, want %q", row.name, got, row.want)
			}
			// Refused, it is spent all the same: the right binding gets no more.
			if got := take(token, alice); got != "used" {
				t.Errorf("after a refusal, the token taken with its own binding: %q, want used", got)
			}
		})
	}

	t.Run("an unknown token", func(t *testing.T) {
		if got := take("cfm_AAAAAAAAAAAAAAAAAAAAAAAAAA", alice); got != "unknown" {
			t.Errorf("an unknown token: %q, want unknown", got)
		}
		if got := take("", alice); got != "unknown" {
			t.Errorf("an empty token: %q, want unknown", got)
		}
	})
}

// 20 confirmations wait per MCP token, 1000 in all: beyond, the oldest goes.
func TestConfirmations_Caps(t *testing.T) {
	t.Run("20 per MCP token", func(t *testing.T) {
		store := mcp.NewConfirmations(func() time.Time { return time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC) })
		var tokens []string
		for i := range 21 {
			token, _ := store.Put("alice", "tokenA", "delete_format", fmt.Sprint(i), "state")
			tokens = append(tokens, token)
		}
		// Another MCP token is not held against the first.
		bob, _ := store.Put("bob", "tokenB", "delete_format", "0", "state")

		if got := store.Take(tokens[0], "alice", "tokenA", "delete_format", "0", "state"); got != "unknown" {
			t.Errorf("the oldest of 21: %q, want unknown (dropped)", got)
		}
		for i := 1; i < 21; i++ {
			if got := store.Take(tokens[i], "alice", "tokenA", "delete_format", fmt.Sprint(i), "state"); got != "" {
				t.Errorf("confirmation %d of 21: %q, want it to fit", i+1, got)
			}
		}
		if got := store.Take(bob, "bob", "tokenB", "delete_format", "0", "state"); got != "" {
			t.Errorf("the confirmation of another MCP token: %q, want it to fit", got)
		}
	})

	t.Run("1000 in all", func(t *testing.T) {
		store := mcp.NewConfirmations(func() time.Time { return time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC) })
		var tokens []string
		for i := range 1001 {
			// One confirmation per MCP token: only the total can drop one.
			token, _ := store.Put("user", fmt.Sprint("token", i), "delete_format", "args", "state")
			tokens = append(tokens, token)
		}
		if got := store.Take(tokens[0], "user", "token0", "delete_format", "args", "state"); got != "unknown" {
			t.Errorf("the oldest of 1001: %q, want unknown (dropped)", got)
		}
		if got := store.Take(tokens[1], "user", "token1", "delete_format", "args", "state"); got != "" {
			t.Errorf("the second of 1001: %q, want it to fit", got)
		}
		if got := store.Len(); got != 999 {
			t.Errorf("%d confirmations wait after two were taken, want 999", got)
		}
		// Twenty more: the oldest go, and the total stays at 1000.
		for i := range 20 {
			store.Put("user", "busy", "delete_format", fmt.Sprint(i), "state")
		}
		if got := store.Len(); got != 1000 {
			t.Errorf("%d confirmations wait, want 1000", got)
		}
	})

	t.Run("the expired go at each new one", func(t *testing.T) {
		clock := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
		store := mcp.NewConfirmations(func() time.Time { return clock })
		for i := range 5 {
			store.Put("user", "token", "delete_format", fmt.Sprint(i), "state")
		}
		clock = clock.Add(11 * time.Minute)
		store.Put("user", "token", "delete_format", "new", "state")
		if got := store.Len(); got != 1 {
			t.Errorf("%d confirmations wait, want the new one only", got)
		}
	})
}
