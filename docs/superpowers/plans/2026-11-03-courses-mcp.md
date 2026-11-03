# « Prends ton dossard » — MCP server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MCP server at `/mcp`, inside the Go program, through which an assistant that holds a person's personal token does everything the site lets that person do — read, races and formats, participations and results, comments, car-sharing and lodging, photo and GPX track, profile and settings, and, for an admin, the admin area — never more, never a password, an email or a passkey secret, and never a deletion or an erasure without a confirmation the person gave.

**Architecture:** One migration (`9k_mcp_tokens.go`: the `mcp_tokens` table, null rules, a `/mcp` rate-limit rule of 1 500 a minute per address, a backstop for requests with no valid token). A package `server/mcpauth`: tokens (`ptd_<id>_<secret>`, SHA-256 only, constant-time check, no expiry), their hooks (five per account, deleted when the account is disabled) and their routes (`/api/app/mcp-tokens`). A package `server/mcp`: the three `/mcp` routes with a limit of 300 requests per minute per token, the official Go SDK in stateless JSON mode, thirty-two member tools and eleven admin tools whose every read and write is an **in-process request to PocketBase's own router** with a 60-second session token of the person, so the API rules, routes and hooks of the site decide. Two SDK servers, chosen for each request by the role read on the account: for a member, an admin tool does not exist. Risky calls go through a **confirmation step** (spec § 6.13): the first call writes nothing and answers what would be lost and a single-use, 10-minute token bound to the MCP token, the tool, the normalized arguments and the state shown, kept in memory. Files reach the tools in base64 (512 KB) or through **upload slots** (`start_upload`, then `PUT /api/app/mcp-uploads/{id}` with a secret header), kept in memory. A package `server/wording` (the words of the calendar feed, now shared). A « Assistant IA (MCP) » section in Réglages. A Go client, `tools/mcpcheck`, for the end-to-end check.

**Tech Stack:** Go 1.27 + PocketBase v0.41.1 (`ganigeorgiev.com/pocketbase/pocketbase`), `github.com/modelcontextprotocol/go-sdk` v1.8.0 (new), React 19, TanStack Router/Query, Tailwind 4 (« Crête », the default of the skins, light and dark), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-courses-mcp-design.md` (brought up to date in Task 12). Section numbers below (« spec § 4.3 ») are the spec's.

**Tasks:** 1 token model · 2 token routes and Réglages · 3 the `/mcp` endpoint · 4 reading races · 5 reading the home page, a runner, the stats · 6 confirmations, races and formats · 7 participations and results · 8 comments, car-sharing and lodging · 9 files: photo and track · 10 profile and settings · 11 admin tools · 12 docs · 13 end to end.

## Global Constraints

### Where to work

- The worktree exists already: `C:\Users\guill\dev\courses\.superpowers\worktrees\mcp`, on the branch `feat/mcp` cut from `feat/v1` at 52be590 (the production line: v6 and its themes are merged), with the front dependencies installed. There is nothing to create.

- Work only in that worktree (branch `feat/mcp`). Never touch the main checkout (`C:\Users\guill\dev\courses`, on `feat/v1`, which holds an uncommitted change of the user), the worktrees of `v6/themes` and its sub-branches, or the `design/v4-*` branches.
- Shell state does not persist: **every Git Bash command below is run after** `source /c/Users/guill/dev/courses/.superpowers/sdd/2026-10-31-courses-v1/env.sh && cd /c/Users/guill/dev/courses/.superpowers/worktrees/mcp && `. The blocks below leave that prefix out.

### Inherited

- Every v5 constraint holds (`.superpowers/sdd/2026-11-02-courses-v5/constraints.md`), among which:
  - a server error code goes in **four places in the same commit**: `server/apperr/codes.go`, `ERROR_CODES` (`web/src/i18n/errors.ts`), a message in `fr.errors` and `en.errors`, and the sorted `want` list of `server/apperr/apperr_test.go`;
  - every UI text in `web/src/i18n/fr.ts` and `en.ts` (`en.ts` is `satisfies Messages`);
  - 44 px targets; submit buttons use `aria-disabled` + a synchronous ref guard, never `disabled`; the focus never falls on `<body>`; light, dark and forced colours;
  - a clause that compares a relation to the caller starts with `@request.auth.id != ""`; the rules of a new table live in its migration; every migration has a tested rollback; invariants are model hooks;
  - never stage `docs/superpowers/specs/2026-10-31-courses-design.md`;
  - no real WebAuthn call; never contact `*.ketra.fr`;
  - the v5 rule « never touch `.superpowers/worktrees/*` » now reads: never touch **another** worktree than `.superpowers/worktrees/mcp`.

### Specific to this plan

- **One new dependency**: `github.com/modelcontextprotocol/go-sdk` **v1.8.0**, added in Task 3. After `go mod tidy`, the `go.mod` diff must only add it and `github.com/google/jsonschema-go v0.4.3`, `github.com/segmentio/asm v1.1.3`, `github.com/segmentio/encoding v0.5.4`, `github.com/yosida95/uritemplate/v3 v3.0.2`, `golang.org/x/time v0.15.0` (indirect); no existing module may change version. Nothing new on the front.
- **Next migration**: `9k_mcp_tokens.go` (after 9j, naming rule of `server/migrations/doc.go`). No other migration: the MCP adds no field to the site's tables.
- **Go tests** use the repo's harness `courses/server/testutil` (`NewApp`, `NewAppWith`, `Seed`, `RunRows`, `NewSequence`, `Token`, and `RequestLogs`, which Task 3 moves there from `server/invitations/invitations_test.go`). MCP requests in tests go through `tests.ApiScenario` (helpers of `server/mcp/mcp_test.go`, Task 3). `ApiScenario` builds a new router and triggers `OnServe` again **for each request** on the same app: whatever must outlive a request (the token limiter, the confirmations, the upload slots) is made in `Register`, never in the `OnServe` closure.
- **Test packages.** `testutil` imports `setup`, which imports `mcp` and `mcpauth`: a test file of `package mcp` that imports `testutil` is an import cycle. So **every test file of `server/mcp` and of `server/mcpauth` is an external one** (`package mcp_test`, `package mcpauth_test`), as in `server/participations`, and the `export_test.go` of each package (`package mcp`, `package mcpauth`) re-exports what they need (`var PlanBatch = planBatch`, `type EventDraft = eventDraft`, …). Each task says what it adds to it. A symbol of an `_test.go` file is seen by the tests of its own package only: the tests of `server/mcp` never call something of `export_test.go` of `mcpauth`.
- **Ports of the front**: where a tool does what front code does (`buildBatch`, `eventEndDate`, `shortens`, `duplicates`, `pending`, `registrationTodo`, `resultsToEnter`, `stats`, `resultParts` with `raceTime` and `ordinal`, `isEdited`, `parseGpx`, `gpxStats`, `memberState`), the Go code says which TS function it ports, and its tests are the cases of the TS tests, named after them. The TS code does not change.
- **Web tests** run through `bash /c/Users/guill/dev/courses/.superpowers/sdd/2026-11-02-courses-v6/vt.sh /c/Users/guill/dev/courses/.superpowers/worktrees/mcp [files…]`, never `pnpm test` directly: the browser-test port (63315) is shared with the other worktrees, and the script waits for it.
- **Local servers**: PocketBase on **8090** and Vite on **5173** only. The v6 agent may hold them: check first (`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/health` must print `000`), and wait if a server answers. Data goes in a directory of the session scratchpad (`--dir`), never in another worktree's `pb_data`. Stop what you start.
- **`server/mcp` never writes itself**: no `Save`, `Delete`, `RunInTransaction`, `DB()`, `NonconcurrentDB()`; every action is an in-process API request (spec § 5), the admin ones through the site's own admin routes and collections. A test of Task 3 reads its sources. Only `server/mcpauth` writes, and only to `mcp_tokens`. (The upload slots and the confirmations are memory, not the database.)
- **Rights are the site's**: a tool never checks a right to allow something; it may only announce a refusal the site will give (spec § 5.3). Admin tools are only on the admin server, and each starts with `requireAdmin` (Task 11).
- **Confirmations** (spec § 6.13): every write tool goes through `guard` (Task 6) before writing; each task that adds a risky case adds its rows to `TestTools_Confirmation_NothingWrittenFirst`, which proves that a risky call without a valid confirmation makes no write request at all.
- **Secrets**: no tool ever reads or outputs an email, a password, a `token_hash`, a passkey `credential`, another person's MCP token, a calendar link other than the caller's own. A real token of any kind (MCP, confirmation, upload, invitation URL, calendar URL) is never printed — not in a log, a test failure message, a report, a screenshot kept in the repo, a commit. A test that needs to name one prints at most its first 8 characters. Local throwaway tokens of the e2e live in the memory of `tools/mcpcheck`.
- **Texts**: tool names in English; tool titles, descriptions, server instructions, summaries, warnings and error messages in French (spec § 6). UI texts in French and English.
- **Clock**: "today" is the day in Paris. `server/mcp` has `var now = time.Now`, replaced in tests through `SetNow` (`export_test.go`, restored by `t.Cleanup`); `server/mcpauth` has its own for `last_used_at`, replaced through its own `SetNow` in the tests of `mcpauth` only: the tests of `server/mcp` put `last_used_at` back in the database instead. The limiter, the confirmations and the upload slots read the clock through `func() time.Time { return now() }`, so that `SetNow` reaches them. A test that needs a race that has not happened yet (`status_before_race`) puts it in 2099; one that needs a past race uses the fixture (June 2026).
- **Filters**: a value written into a PocketBase filter of an inner request is only a day checked with `events.ParseDay` or an id that matches `^[a-z0-9]{15}$`. Free text (a search, a name) never goes into a filter: it is matched in Go (`duplicates`, Task 6, asks for the events by days and matches the words of the name in Go; the site's `name ~ "word"` is not ported).
- **Checks before each commit**: `go test ./...`, `test -z "$(gofmt -l server tools)" && go vet ./...`; when `web/` changed: `vt.sh` (whole suite), `pnpm --dir web typecheck`, `pnpm --dir web lint`, `pnpm --dir web fmt:check`.
- **Commits**: GPG-signed (`commit.gpgsign` is on; never `--no-gpg-sign` or `--no-verify`); message in French in the style of the history (`feat: …`, `test: …`, `docs: …`), a body when useful, then a blank line and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; files staged **one by one** by path (never `git add -A`, `.`, `-u`); **never push**. Each task ends with one commit (the commands are given), plus the files the implementer had to touch beyond the list, staged one by one too.
- **Deploying is not part of these tasks.** When the user asks for it, the production deploy **backs up the `pb_data` volume first**, container stopped, as for the earlier deploys, then keeps the old source, then rebuilds:

  ```bash
  cd /opt/prends-ton-dossard
  OLD=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
  VOLUME=$(docker volume ls -q | grep 'prends-ton-dossard_pb_data$')
  docker compose stop courses
  docker run --rm -v "$VOLUME":/pb_data:ro -v /root/backups:/backup alpine \
    tar czf "/backup/prends-ton-dossard-pb_data-$OLD-$(date +%Y%m%d-%H%M).tar.gz" -C /pb_data .
  cp -a /opt/prends-ton-dossard "/opt/prends-ton-dossard.old-$OLD"
  # then put the new source in place as for the earlier deploys, and:
  docker compose up -d --build && docker compose ps   # "healthy"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://prends-ton-dossard.ketra.fr/mcp   # 401 (run by the user at deploy time, never by an agent)
  ```

### PocketBase conventions in tests (unchanged)

When a rule refuses, PocketBase answers: **list** `200` with an empty list; **view, update, delete** `404`; **create** `400`; **null rule** `403`. A validation error answers `400` with `data.<field>.code`. A unique constraint becomes `validation_not_unique`. A batch that fails answers `400` with `data.requests.<index>.response`.

### MCP requests in tests

`POST /mcp` with `Authorization: Bearer <token>`, `Accept: application/json, text/event-stream`, `Content-Type: application/json`, and a JSON-RPC body. In stateless mode a `tools/call` needs no `initialize` first. A tool result is `result.isError`, `result.structuredContent` and `result.content[0].text` (the JSON, or the French error).

### The pattern of a write tool

Every write tool (Tasks 6 to 11) is written the same way, so that a reviewer checks one shape:

1. read what it needs through `innerAPI` (`GET`s only);
2. normalize its input (names to ids, defaults, trimmed texts; a file to the SHA-256 of its bytes);
3. announce the refusals the site will give, when it can see them (spec § 5.3) — a tool error, no confirmation;
4. compute its `risk` (spec § 6.13 table; `nil` when none);
5. `guard(ctx, tool, normalized, risk, input.Confirmation)`: proceed, or answer `done: false` with a confirmation;
6. write through `innerAPI` (one request, or one batch);
7. read again if the answer needs it, and answer `done: true`, `summary`, `warnings`.

## Review Focus

1. **A token that does more than its owner.** Every action must go through the API with the owner's session; a direct write, or a missing request hook, would skip `added_by`, `confirmed`, `author`, `owner` or a rule. Tests: `TestPackage_NoDirectWrites` and `TestInner_RunsTheRulesAndHooks` (Task 3), `TestTools_FollowTheRulesOfTheOwner` (Tasks 7, 8, 10).
2. **A secret that leaks.** Shown once, never in a list, a log or an answer: MCP tokens, upload secrets, invitation and calendar URLs, emails, passkey credentials. Tests: `TestMCPTokenRoutes_ListNeverShowsTheSecret` (Task 2), `McpSection — fermer la fenêtre efface le jeton de la page` (Task 2), `TestMCP_TokenIsNotLogged` (Task 3), `TestTools_ReadsHoldNoSecret` (Tasks 4, 5), `TestUploads_SecretIsNotLogged` (Task 9), `TestTools_Passkeys` (Task 10), `TestAdmin_LinkIsNotLogged` (Task 11).
3. **A token that outlives its right.** Revoked or disabled must mean refused at the next request. Tests: `TestMCPTokens_DisablingTheAccountDeletesItsTokens` (Task 1), `TestMCP_Unauthorized` (Task 3), `TestTools_McpTokens` (Task 10).
4. **The dates of a race.** The end date comes from the formats; a format moved past the end, or a race moved with its dated formats, passes in one call; a kept format that does not change is not sent. Tests: the `TestPlan_*` ports of `saveEvent.test.ts`, `TestPlan_UnchangedFormatsAreNotSent`, `TestTools_UpdateFormat_MovesTheEndInOneCall`, `TestTools_UpdateEvent_MovesTheRaceWithItsFormats` (Task 6).
5. **A confirmation that leaks or lingers.** A risky call without a valid confirmation must write nothing; with one, write once; a reused, expired, other-tool, other-arguments, other-token or stale confirmation must be refused. Tests: `TestConfirmations_Store` and `TestTools_Confirmation_*` (Task 6), and the rows each later task adds.
6. **A file that is not what it says.** An upload over its size or of the wrong type, a slot used twice or by another token, a GPX without points, a photo of somebody else for a member. Tests: `TestUploads_*` and `TestTools_SetPhoto`, `TestTools_SetTrack` (Task 9).
7. **An admin tool in a member's hands.** A member's `tools/list` must hold no `admin_…` tool, and calling one by name must get exactly the answer of a tool that does not exist (JSON-RPC `-32602`, `unknown tool "…"`), with nothing written; a demoted admin loses them at the next request. Tests: `TestMCP_MemberDoesNotSeeTheAdminTools`, `TestMCP_RoleChangesAtTheNextRequest`, `TestTools_AdminToolsCheckTheRole` (Task 11).
8. **The limit per token.** 300 a minute per token, not per address; another token is not slowed. Test: `TestMCP_RateLimitPerToken` (Task 3).
9. **The demo.** With `DEMO_LOGIN_EMAIL`, no `/mcp`, no token routes, no upload route. Tests: `TestMCPTokenRoutes_AbsentOnTheDemo` (Task 2), `TestMCP_AbsentOnTheDemo` (Task 3), `TestUploads_AbsentOnTheDemo` (Task 9).

---

### Task 1: The token model (migration 9k, `mcpauth`, two error codes)

**Files:**
- Create `server/migrations/9k_mcp_tokens.go`.
- Modify `server/migrations/migrations_test.go` (add `mcp_tokens` to `TestMigrations_CollectionsExist` and `TestMigrations_DownThenUp`; add the `/mcp` rule to `TestMigrations_Settings`, which counts the rules of its `wantRules`, and to `TestMigrations_SettingsRateLimitRulesAreEffective`; new `TestMigrations_MCPTokensDownThenUp`).
- Create `server/mcpauth/tokens.go`, `server/mcpauth/hooks.go`, `server/mcpauth/tokens_test.go`, `server/mcpauth/hooks_test.go`, `server/mcpauth/export_test.go` (the tests are `package mcpauth_test`; `export_test.go` holds `SetNow`, for them only).
- Modify `server/setup/setup.go` (`mcpauth.Register(app, cfg)`).
- Modify `server/apperr/codes.go` (`CodeTokenInvalid = "token_invalid"`, `CodeTokenLimit = "token_limit"`), `server/apperr/apperr_test.go` (`want`: `"time_invalid", "token_invalid", "token_limit", "wrong_password"`), `web/src/i18n/errors.ts` (`ERROR_CODES`), `web/src/i18n/fr.ts` and `en.ts` (`errors.token_invalid`, `errors.token_limit`).

**Interfaces:**

```go
// server/migrations/9k_mcp_tokens.go
// mcp_tokens: user (relation users, required, cascade), name (text, required, Min 1, Max 50),
// token_hash (text, required, Hidden), last_used_at (date); created/updated; index on user;
// every rule nil. Plus the rate-limit rule {Label: "/mcp", MaxRequests: 1500, Duration: 60},
// prepended to the rules (as 3_settings.go does): a backstop per address for the requests that
// carry no valid token, well above the 300 a minute per token of Task 3, so that two assistants
// behind one box do not share one limit. A label without a trailing slash is matched by
// equality: its place in the list does not matter. Down: delete the collection and remove the
// rule; nothing to do when they are already gone.

// server/mcpauth
const (
	Prefix        = "ptd_"
	MaxPerAccount = 5
)
var ErrInvalid = errors.New("mcpauth: invalid token")

// Create makes a token named name (trimmed) for the account userID. token is the only
// copy of the secret; the record keeps its SHA-256 (invitations.Hash).
func Create(app core.App, userID, name string) (token string, record *core.Record, err error)

// Authenticate checks the value of an Authorization header (spec § 4.3) and returns the
// account and the token record. Every refusal is ErrInvalid.
func Authenticate(app core.App, header string) (user, token *core.Record, err error)

// Touch records a use of token: last_used_at = now, unless it was set less than a minute ago.
func Touch(app core.App, token *core.Record) error

// Register attaches the hooks (always) and, outside the demo, the routes (Task 2).
func Register(app core.App, cfg config.Config)

var now = time.Now // export_test.go: func SetNow(t testing.TB, at time.Time)
```

- The token is `ptd_` + record id (15 × `[a-z0-9]`) + `_` + 43 × `[A-Za-z0-9_-]` (32 random bytes, base64url, from `invitations.NewToken`). The record id is set by `Create` (`core.GenerateDefaultRandomId()`) before the save, so that the token names it.
- `Authenticate`: case-insensitive `Bearer `, exact shape (a regexp), lookup by id, `subtle.ConstantTimeCompare` of the hex hashes; an unknown id is compared with a fixed dummy hash; the account must exist and not be disabled.
- Hooks: `OnRecordCreate("mcp_tokens")` refuses a sixth token of the account with `apperr.New(400, CodeTokenLimit)`; `OnRecordUpdate("users")` loads the stored account before `e.Next()` (as `accounts` does), and **after** `e.Next()` succeeds, when the account went from enabled to disabled, deletes its tokens through `e.App` (the same transaction, if any).

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `TestMigrations_MCPTokensDownThenUp`: the fields and their flags (relation to `users`, required, cascade, `MaxSelect` 1; `name` Min 1 Max 50 required; `token_hash` required and hidden; `last_used_at` a date field), the index, the five nil rules; the settings have `/mcp` 1 500 per 60 s, and `FindRateLimitRule([]string{"POST /mcp", "/mcp"})` finds it; down: the table and the rule are gone, and a second down is no error; up again: both are back (pattern of `TestMigrations_CalendarFeedsDownThenUp`).
  - `TestMigrations_Settings` and `TestMigrations_SettingsRateLimitRulesAreEffective` (existing, extended): `wantRules` has `"/mcp": {1500, 60}` (the test counts the rules), and `POST /mcp` is limited by it to 1 500.
  - `TestMCPTokens_CreateGivesTheSecretOnce`: the token matches the shape; its id part is the record id; `token_hash` is the SHA-256 hex of the secret part; no field of the record holds the token or the secret.
  - `TestMCPTokens_Authenticate` (table): a good token → Alice; `bearer` in lower case → Alice; Bob's token → Bob; and `ErrInvalid` for: no header, `Basic …`, no `ptd_` prefix, a token one character short, an unknown id, the right id with a wrong secret, Alice's session token (`testutil.Token`), a disabled account (set in the database).
  - `TestMCPTokens_Name`: `"  Claude sur mon PC  "` → `"Claude sur mon PC"`; `""` and `"   "` → a validation error on `name` with code `validation_required`; 51 characters → `validation_max_text_constraint`.
  - `TestMCPTokens_LimitOfFive`: five tokens for Alice pass; the sixth → `token_limit`; Bob still creates one.
  - `TestMCPTokens_DisablingTheAccountDeletesItsTokens`: as the admin, `PATCH /api/collections/users/records/<bob>` `{"disabled":true}` → Bob's tokens are gone, Alice's stay; re-enabling brings none back; the admin trying to disable the last admin (themself) is refused (`last_admin`) and their tokens stay.
  - `TestMCPTokens_GoWithTheAccount`: deleting Bob's account (as a superuser would, `app.Delete`) deletes his tokens.
  - `TestMCPTokens_TouchAtMostOncePerMinute`: with `SetNow`: first `Touch` sets the time; 30 s later, unchanged; 61 s later, the new time.
  - Front: the existing `web/src/i18n/errors.test.ts` fails until the two codes have their messages.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcpauth/ ./server/migrations/ ./server/apperr/ 2>&1 | tail -5
  ```

  Expected: `FAIL` — `undefined: mcpauth.Create` (and the others), `the migration 9k_mcp_tokens.go is not registered`, the `want` list of `TestCodes_FrontEndContract`.
- [ ] **Step 3: implement** the migration, the package, the hooks, the two codes in the four places. Messages: `token_invalid` « Ce jeton n'est pas valide, ou il a été révoqué. » / "This token is not valid, or it was revoked."; `token_limit` « Tu as déjà 5 jetons : révoque-en un pour en créer un autre. » / "You already have 5 tokens: revoke one to make another." Comment the package like the others (why the hash only, why the id in the token, why constant time, why no expiry).
- [ ] **Step 4: run them, see them pass.**

  ```bash
  go test ./server/mcpauth/ ./server/migrations/ ./server/apperr/
  bash /c/Users/guill/dev/courses/.superpowers/sdd/2026-11-02-courses-v6/vt.sh /c/Users/guill/dev/courses/.superpowers/worktrees/mcp src/i18n/errors.test.ts
  ```

  Expected: `ok  	courses/server/mcpauth`, `ok  	courses/server/migrations`, `ok  	courses/server/apperr`; Vitest `Test Files  1 passed`.
- [ ] **Step 5: full checks** (Global Constraints), all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/migrations/9k_mcp_tokens.go
  git add server/migrations/migrations_test.go
  git add server/mcpauth/tokens.go
  git add server/mcpauth/hooks.go
  git add server/mcpauth/tokens_test.go
  git add server/mcpauth/hooks_test.go
  git add server/mcpauth/export_test.go
  git add server/setup/setup.go
  git add server/apperr/codes.go
  git add server/apperr/apperr_test.go
  git add web/src/i18n/errors.ts
  git add web/src/i18n/fr.ts
  git add web/src/i18n/en.ts
  git commit -m "feat: des jetons personnels pour les assistants IA (MCP)" -m "Seule l'empreinte du secret est gardée ; cinq jetons par compte, sans expiration ; désactiver un compte supprime ses jetons." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 2: Token routes and the « Assistant IA (MCP) » section of Réglages

**Files:**
- Create `server/mcpauth/routes.go`, `server/mcpauth/routes_test.go`.
- Modify `server/config/config.go` (`func (c Config) Demo() bool`, true when `DemoLoginEmail` is set) and `server/config/config_test.go`.
- Create `web/src/features/mcp/api.ts`, `web/src/features/mcp/command.ts`, `web/src/features/mcp/command.test.ts`, `web/src/features/mcp/McpSection.tsx`, `web/src/features/mcp/McpSection.test.tsx`.
- Modify `web/src/features/profile/SettingsPage.tsx` (`<McpSection />` after `<CalendarSection />` in `AppSections`) and `web/src/features/profile/SettingsPage.test.tsx`, `web/src/i18n/fr.ts`, `web/src/i18n/en.ts` (an `mcp` block), `web/vite.config.ts` (proxy: `"/mcp": "http://127.0.0.1:8090"` next to `/api`).
- Modify the three existing test files that mount the settings page with a `pb.send` that gives **every** path the same answer (`{ exists: false }`, `{}`, or what a test sets for the email), which has no `tokens` (the page would crash on it): `web/src/features/profile/SettingsPage.test.tsx` (its `beforeEach`, and the four tests that set `mocks.send.mockResolvedValue(…)` or `mockRejectedValue(…)` for the email), `web/src/routes/profil/profil.test.tsx` (`send`), `web/src/skins/smoke.test.tsx` (`send`, run for every skin and mode on `/profil/reglages`). In each, `/api/app/mcp-tokens` is answered with `{ url: "http://localhost:5173/mcp", max: 5, tokens: [] }`, by path, and every other path keeps the answer it had (in `SettingsPage.test.tsx` a helper `sendAs(answer)` does it, and the four tests call it instead of `mockResolvedValue` / `mockRejectedValue`).

**Interfaces:**

- Routes (spec § 4.5), all `.Bind(apis.RequireAuth("users"))`, not registered when `cfg.Demo()`:
  - `GET /api/app/mcp-tokens` → `{"url": "<APP_URL>/mcp", "max": 5, "tokens": [{"id","name","created","lastUsedAt"}]}`, newest first, `lastUsedAt` `""` when never used;
  - `POST /api/app/mcp-tokens` `{"name"}` → `{"id","name","created","token","url"}`;
  - `DELETE /api/app/mcp-tokens/{id}` → 204; not the caller's, or unknown → `404 not_found`.
- Front:

  ```ts
  // web/src/features/mcp/api.ts — every call through pb.send, like features/calendar/api.ts
  export type McpToken = { id: string; name: string; created: string; lastUsedAt: string };
  export type McpStatus = { url: string; max: number; tokens: McpToken[] };
  /** The tokens of the member; null when the server has no MCP (404: the demo). Key ["mcp-tokens", userId]. */
  export function useMcpTokens(): UseQueryResult<McpStatus | null>;
  /** gcTime 0: the answer holds the token. The list gets the new token without it. */
  export function useCreateMcpToken(): UseMutationResult<McpToken & { token: string; url: string }, Error, string>;
  export function useRevokeMcpToken(): UseMutationResult<void, Error, string>;

  // web/src/features/mcp/command.ts
  /** The command that adds the server to Claude Code, for the user (never a project's .mcp.json). */
  export function claudeCommand(url: string, token: string): string;
  // → claude mcp add --transport http --scope user prends-ton-dossard <url> --header "Authorization: Bearer <token>"
  ```

- `McpSection` (spec § 7): `Section` with the intro, the list (rows styled like the passkey rows), « Nouveau jeton » or the limit text, the create dialog (two steps in one `<dialog>`: the name form, then the token, the command and « J'ai copié le jeton »), the revoke confirmation. The token lives in the dialog's state only; closing the dialog (button or Escape) clears it and resets the mutation. The token and the command are shown by one local component of `McpSection.tsx`, `CopyField` (a read-only field, single or multiline, and its copy button), which behaves as `LinkField` of `CalendarSection` does (the text is selected when the clipboard refuses; « Jeton copié. » / « Commande copiée. » as a toast and in a `role="status"` line of the dialog); `CalendarSection` is not touched. Focus: the token field takes it, selected, when shown; after a revocation the section title takes it; a closed dialog gives it back to its opener, or to the title (`useRestoreFocus`). Renders nothing when `useMcpTokens()` gives `null`. When the read fails for any other reason, it says so with « Réessayer » (`LoadFailure`, as « Agenda » does: the title takes the focus when the button is tapped).
- Texts (`mcp` block, fr then en), from spec § 7: `title`, `intro`, `empty`, `created(date)`, `lastUsed(date)`, `neverUsed`, `revoke`, `revokeLabel(name)`, `revokeTitle`, `revokeWarning(name)`, `revoked`, `create`, `limit(max)`, `createTitle`, `name`, `nameHint`, `createSubmit`, `showOnce`, `tokenLabel`, `copyToken`, `tokenCopied`, `claudeCode`, `commandLabel`, `copyCommand`, `commandCopied`, `otherClients(url)`, `done`.

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `TestMCPTokenRoutes` (`RunRows`): anonymous GET, POST and DELETE → 401; Alice GET → `"tokens":[]`, `"url":"http://localhost:5173/mcp"`, `"max":5`; Alice POST `{"name":"Claude"}` → 200 with `"token":"ptd_`; then GET has `"name":"Claude"` and no `"token"`; POST `{"name":""}` → 400 `"name":{"code":"validation_required"`; POST a sixth → 400 `"code":"token_limit"`; Alice DELETE hers → 204 and gone; Alice DELETE Bob's → 404 `not_found`, Bob's still there; `GET /api/collections/mcp_tokens/records` as Alice → 403.
  - `TestMCPTokenRoutes_ListNeverShowsTheSecret`: two tokens; the GET body holds neither token, neither secret part, neither `token_hash` nor the hashes.
  - `TestMCPTokenRoutes_AbsentOnTheDemo`: `testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})` → GET and POST 404.
  - `TestLoad_Demo` (config): `Demo()` false without the variable, true with it.
  - `command.test.ts`: `claudeCommand — la commande de Claude Code, avec --scope user et l'en-tête` (the exact string).
  - `McpSection.test.tsx` (mock `pb.send` like `CalendarSection.test.tsx`; `ToastProvider`, `I18nProvider` in fr and en):
    - `McpSection — sans jeton, « Aucun jeton pour l'instant. » et « Nouveau jeton »`;
    - `McpSection — la liste montre le nom, la création et la dernière utilisation` (and « Jamais utilisé »);
    - `McpSection — créer un jeton le montre une fois, avec la commande de Claude Code` (the field has the token and the focus, selected; the command field has `claudeCommand(url, token)`);
    - `McpSection — « Copier le jeton » et « Copier la commande » copient` (a stub clipboard; the status line);
    - `McpSection — fermer la fenêtre efface le jeton de la page` (after « J'ai copié le jeton », and after Escape: the token is nowhere in `document.body`, and the list shows the new row without it);
    - `McpSection — un nom vide ou refusé garde la fenêtre ouverte avec l'erreur` (`validation_required`, `token_limit`, translated, `role="alert"`, the typed name kept);
    - `McpSection — à 5 jetons, le message de la limite remplace « Nouveau jeton »`;
    - `McpSection — révoquer demande confirmation, puis le titre prend le focus`;
    - `McpSection — un double clic sur « Créer le jeton » n'envoie qu'une requête` (`clickTwice`, `expectBusy` of `test/busyButton`);
    - `McpSection — absente quand le serveur répond 404`;
    - `McpSection — une panne de lecture (pas un 404) dit l'erreur avec « Réessayer », et le titre prend le focus au clic` (as `CalendarSection.test.tsx`);
    - `McpSection — en anglais` (one text per state);
  - `SettingsPage — « Assistant IA (MCP) » vient après « Agenda »`.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcpauth/ ./server/config/ 2>&1 | tail -3
  bash /c/Users/guill/dev/courses/.superpowers/sdd/2026-11-02-courses-v6/vt.sh /c/Users/guill/dev/courses/.superpowers/worktrees/mcp src/features/mcp src/features/profile/SettingsPage.test.tsx src/routes/profil/profil.test.tsx src/skins/smoke.test.tsx 2>&1 | tail -5
  ```

  Expected: Go `FAIL` (404 instead of 200 on the routes; `c.Demo undefined`); Vitest fails to import `./McpSection` and `./command`.
- [ ] **Step 3: implement** the routes, `Demo()`, the front files, the texts, the proxy.
- [ ] **Step 4: run them, see them pass** (same commands). Expected: `ok  	courses/server/mcpauth`, `ok  	courses/server/config`; Vitest `Test Files  5 passed` (`command`, `McpSection`, `SettingsPage`, `profil`, `smoke`).
- [ ] **Step 5: look at it.** Server and front on the reserved ports, on a seeded scratch database:

  ```bash
  D="$(mktemp -d)"; go run ./server seed --dir "$D" && go run ./server serve --http=127.0.0.1:8090 --dir "$D"   # in the background
  pnpm --dir web dev                                                                                      # in the background
  ```

  Sign in as `alice@example.test` (`courses-dev-password`) at `http://localhost:5173/connexion`, open `/profil/reglages`, create a token, look at the dialog at 375 px and 1280 px, in light and dark, and in forced colours; revoke it. Screenshots of the dialog only after the token is revoked, or with the token field cropped, under `.superpowers/sdd/mcp/` (outside the repo). Stop both servers, delete `$D`.
- [ ] **Step 6: full checks**, all green.
- [ ] **Step 7: commit.**

  ```bash
  git add server/mcpauth/routes.go
  git add server/mcpauth/routes_test.go
  git add server/config/config.go
  git add server/config/config_test.go
  git add web/src/features/mcp/api.ts
  git add web/src/features/mcp/command.ts
  git add web/src/features/mcp/command.test.ts
  git add web/src/features/mcp/McpSection.tsx
  git add web/src/features/mcp/McpSection.test.tsx
  git add web/src/features/profile/SettingsPage.tsx
  git add web/src/features/profile/SettingsPage.test.tsx
  git add web/src/routes/profil/profil.test.tsx
  git add web/src/skins/smoke.test.tsx
  git add web/src/i18n/fr.ts
  git add web/src/i18n/en.ts
  git add web/vite.config.ts
  git commit -m "feat: créer, lister et révoquer ses jetons d'assistant dans Réglages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 3: The `/mcp` endpoint: auth, limit per token, the in-process API, the two servers

**Files:**
- Modify `go.mod`, `go.sum`: `go get github.com/modelcontextprotocol/go-sdk@v1.8.0 && go mod tidy`.
- Create `server/mcp/route.go` (`Register`, the three routes, the auth, the limit, the log meta, the choice of the server by role), `server/mcp/limit.go` (the limit per token), `server/mcp/server.go` (`newServer(cfg, deps, role)`: implementation, instructions, the tools of that role), `server/mcp/inner.go` (the in-process API, JSON and multipart), `server/mcp/messages.go` (French messages, field names, `describe`), `server/mcp/schema.go` (`inputSchema[T]` with enums), `server/mcp/tool_whoami.go`.
- Create `server/mcp/mcp_test.go` (helpers), `server/mcp/route_test.go`, `server/mcp/limit_test.go`, `server/mcp/inner_test.go`, `server/mcp/messages_test.go`, `server/mcp/nowrites_test.go`, `server/mcp/export_test.go`. All are `package mcp_test` but `export_test.go` (`package mcp`), which exports: `SetNow`; a constructor of `innerAPI` and of a `caller`, with `withCaller` (for `TestInner_*`); the counter of inner requests by method; `RoleOf`; the token limiter and its constructor with a clock (for `limit_test.go`).
- Create `server/testutil/logs.go`: `RequestLogs(t, app, want)`, moved from `requestLogs` of `server/invitations/invitations_test.go` (which then calls it; the near-copy in `server/calendar/routes_test.go` waits for a message and stays). Modify `server/accounts/hooks.go` and `server/accounts/admin.go`: `isActiveAdmin` becomes the exported `IsActiveAdmin` (the one test of an active admin, which `roleOf` reads too); no change of behaviour.
- Modify `server/setup/setup.go` (`mcp.Register(app, cfg)`), `server/webdist/spa.go` (`reserved`: `.well-known` and `mcp`, as `api` and `_`) and `server/webdist/spa_test.go`.

**Interfaces:**

```go
package mcp

import mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

// Register adds GET, POST and DELETE /mcp to app (and, in Task 9, the upload route);
// nothing on the demo (cfg.Demo()).
func Register(app core.App, cfg config.Config)

// role is the set of tools a token sees (spec § 6.3).
type role int
const (
	roleMember role = iota // the member tools
	roleAdmin              // the member tools and the admin tools
)
// roleOf reads the role on the account, at each request: "admin" and not disabled
// (accounts.IsActiveAdmin, the test of accounts.RequireAdmin), else member.
func roleOf(user *core.Record) role

// caller is who the tools act for, and where the request came from.
type caller struct {
	user, token *core.Record
	role        role
	host, remoteAddr string
	forwarded        http.Header // the headers of app.Settings().TrustedProxy.Headers
	calls            []toolCall  // the tools called, and asked/confirmed, for the request log (under a mutex)
}
func withCaller(ctx context.Context, c *caller) context.Context
func callerOf(ctx context.Context) (*caller, error)

// tokenLimiter allows 300 requests a minute per MCP token: a bucket of 300 that refills
// 5 a second, in memory, keyed by token id; buckets idle for 10 minutes are dropped.
type tokenLimiter struct{ /* mu, buckets map[string]*bucket, now func() time.Time */ }
func (l *tokenLimiter) allow(tokenID string) bool

// innerAPI sends requests to PocketBase's own router, as the caller (spec § 5.1).
type innerAPI struct {
	router *router.Router[*core.RequestEvent]
	once   sync.Once
	mux    http.Handler
	muxErr error
}
func (a *innerAPI) do(ctx context.Context, method, path string, body any) (status int, data []byte, err error)
func (a *innerAPI) get(ctx context.Context, path string, out any) error           // 2xx → decoded, else *apiError
func (a *innerAPI) send(ctx context.Context, method, path string, body, out any) error
// sendForm sends a multipart/form-data body, as the site's SDK does for a new file: fields
// and files. Removing a file is a JSON request ({"avatar": null}, {"gpx": null}), as the site does.
func (a *innerAPI) sendForm(ctx context.Context, method, path string, fields map[string]string, files []formFile, out any) error
type formFile struct{ Field, Name, ContentType string; Data []byte }

// apiError is a refusal of the API: its status, its code, the code of each field, and,
// for a batch, the index of the request that failed (-1 otherwise).
type apiError struct {
	Status  int
	Code    string
	Fields  map[string]string
	Request int
}

// describe turns an error of the API into the French text of a tool error (spec § 6.12);
// any other error is logged (without token) and becomes the generic message. subject names
// the request that a batch refused, from its index (apiError.Request): the tool builds it
// from its operations ("Épreuve 2 (« Trail 15 km »)"); nil for a single request.
func describe(app core.App, err error, subject func(request int) string) error
```

Sketch of the route (the pieces that matter):

```go
// Made here, once for the app, and not in the OnServe closure: a request of ApiScenario
// triggers OnServe again, and a limiter born there would forget the calls made before it.
// Task 6 makes the confirmations here, Task 9 the upload slots.
limiter := newTokenLimiter(func() time.Time { return now() })
app.OnServe().BindFunc(func(se *core.ServeEvent) error {
	deps := &deps{inner: &innerAPI{router: se.Router} /* the mux is built at the first tool call */, cfg: cfg}
	servers := map[role]*mcpsdk.Server{
		roleMember: newServer(deps, roleMember), // the member tools only
		roleAdmin:  newServer(deps, roleAdmin),  // the member tools and the admin tools
	}
	handler := mcpsdk.NewStreamableHTTPHandler(
		// For each request, the server of the role of the token's owner: for a member, an
		// admin tool is not hidden, it does not exist (the SDK's own "unknown tool").
		func(r *http.Request) *mcpsdk.Server { c, _ := callerOf(r.Context()); return servers[c.role] },
		&mcpsdk.StreamableHTTPOptions{
			Stateless: true, JSONResponse: true,
			DisableLocalhostProtection: true, // every request carries a token; see spec § 3.3
			MaxRequestBodyBytes:        1 << 20,
		})
	serve := func(e *core.RequestEvent) error {
		user, token, err := mcpauth.Authenticate(e.App, e.Request.Header.Get("Authorization"))
		if err != nil {
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="prends-ton-dossard"`)
			return apperr.New(http.StatusUnauthorized, apperr.CodeTokenInvalid)
		}
		if !limiter.allow(token.Id) {
			return e.TooManyRequestsError("", nil)
		}
		if err := mcpauth.Touch(e.App, token); err != nil {
			e.App.Logger().Warn("mcp: recording the use of a token", "token", token.Id, "error", err)
		}
		e.Auth = user
		c := &caller{user: user, token: token, role: roleOf(user), host: e.Request.Host, remoteAddr: e.Request.RemoteAddr, forwarded: trustedHeaders(e)}
		handler.ServeHTTP(e.Response, e.Request.WithContext(withCaller(e.Request.Context(), c)))
		e.Set(apis.RequestEventKeyLogMeta, map[string]any{"mcpToken": token.Id, "mcpUser": user.Id, "mcpTools": c.loggedCalls()})
		return nil
	}
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		se.Router.Route(method, "/mcp", serve)
	}
	return se.Next()
})
```

The inner request (`innerAPI.do` and `sendForm`): build the mux once (`a.router.BuildMux()` under `a.once`; never `apis.NewRouter`, spec § 5.2); `session, _ := c.user.NewStaticAuthToken(time.Minute)`; `http.NewRequestWithContext(ctx, method, path, body)` with `Host`, `RemoteAddr` and the trusted headers of the caller, `Authorization: session`, `Content-Type` (JSON, or the multipart boundary), `User-Agent: prends-ton-dossard-mcp`; serve it into an `httptest.ResponseRecorder`; parse a non-2xx answer into `*apiError` (`data.code`, `data.<field>.code`, `data.requests.<i>.response`). The session token is never logged nor returned. `export_test.go` exposes a hook that counts the inner requests by method, for the « no write » tests of later tasks.

Tools follow one pattern (`server.go` registers them; each later task adds its own). `newServer` adds the member tools to every server, and the admin tools (Task 11) only when `role == roleAdmin`; the package keeps the two lists side by side (`memberTools`, `adminTools`), so that a tool is in exactly one. The two servers are made once, at `OnServe`.

```go
mcpsdk.AddTool(server, &mcpsdk.Tool{
	Name: "whoami", Title: "Qui suis-je ?",
	Description: "…in French…",
	Annotations: &mcpsdk.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: ptr(false)},
}, t.whoami)

func (t *tools) whoami(ctx context.Context, _ *mcpsdk.CallToolRequest, _ struct{}) (*mcpsdk.CallToolResult, whoamiOut, error)
```

- Struct tags: `json:"name,omitempty"` for every **optional** input (the SDK's schemas make every field without `omitempty` required) and `jsonschema:"<French description>"`. Enums (statuses, `period`, `action`, `kind`) are set by `inputSchema[T](enums)` on top of `jsonschema.For[T]`, passed as `Tool.InputSchema`.
- Outputs: every slice is non-nil (`[]T{}`): the SDK validates the output against its schema, and `null` is not an array.
- A tool returns a Go error for a tool error: the SDK sends it as `isError: true` with its text, which is French (`describe`, or the tool's own message).
- `whoami` (spec § 6.4): the runner of the caller through an inner `GET /api/collections/runners/records?filter=(user='<id>')`, the role, the token's id and name, `site` = `cfg.AppURL`, `today` = the Paris day of `now()`.
- `messages.go`: the French messages of the codes the tools can meet, copied from `fr.errors` of `web/src/i18n/fr.ts` — the event, format, participation, comment and offer codes (`offer_seats_required`, `offer_seats_below_members`, `offer_full`, `offer_owner_member`, `offer_already_member`, `time_invalid`, `rank_above_total`, `status_before_race`…), the admin ones (`last_admin`, `runner_has_account`, `runner_has_participations`, `race_type_in_use`, `invitation_kind_mismatch`, `merge_same_record`, `merge_formats_different_events`), `not_found`, `forbidden`, and PocketBase's `validation_*` codes the front knows (with the photo's and the track's own messages for `validation_invalid_mime_type` and `validation_file_size_limit`, keyed by field as the front does) —, the French name of each field (spec § 6.12), and the fallback « Le site a refusé (code …). ».
- Server instructions: the text of spec § 6.2, word for word, with its last line for the admin server only.

**Steps:**

- [ ] **Step 1: write the failing tests.** Helpers in `mcp_test.go`: `rpc(t, app, auth, method string, params any) (status int, body string)` (an `ApiScenario` with the three headers) and `callTool(t, app, token, name string, args any) toolResult` (`IsError`, `Text`, `Structured map[string]any`); `newToken(t, app, user)` (`mcpauth.Create`); `confirmAndCall(t, app, token, name, args)` for later tasks (calls once, checks `done: false`, calls again with the token, checks `done: true`).
  - `TestMCP_Unauthorized` (rows): no header, `Bearer nope`, Alice's session token, a revoked token (deleted), a token of a disabled account → 401, `WWW-Authenticate: Bearer realm="prends-ton-dossard"`, `"code":"token_invalid"`; a good token → 200.
  - `TestMCP_RateLimitPerToken` (with the limiter's clock): 300 calls of Alice's token pass, the 301st → 429; Alice's second token and Bob's token still pass; one second later, five more pass. Every call comes from the one address of the test, and the address rule of 1 500 a minute (migration 9k) is nowhere near: it is the limiter of the token that answers.
  - `TestMCP_GetAndDeleteAre405`: with a good token.
  - `TestMCP_Initialize`: 200, `Content-Type: application/json`, `"name":"prends-ton-dossard"`, the instructions start with « Prends ton dossard est le site privé »; the admin's instructions have the admin line, Alice's do not.
  - `TestMCP_ToolsList`: with Alice's token (a member) the names are exactly `wantMemberTools`, with the admin's token exactly `wantMemberTools` + `wantAdminTools` (package-level lists of the test: `[whoami]` and `[]` for now, which Tasks 4–11 extend); each tool has a French `title` and description. The hints come from one table of the test, `wantHints`, which each task extends and which has a row for every tool (the test fails for a tool without one): `readOnlyHint` for a read; `destructiveHint` for every tool that can answer `done: false` with a confirmation (spec § 6.1); `idempotentHint` for the tools that spec § 6.1 names; `openWorldHint: false` for all.
  - `TestMCP_RoleOf`: member → member; admin → admin; a disabled admin → member (`roleOf` alone: `Authenticate` refuses a disabled account anyway).
  - `TestMCP_Whoami`: Alice's token → runner Alice, role `member`, the token's name, `site` `http://localhost:5173`, `today` the day of `SetNow` in Paris (set 2026-06-13T23:30:00Z → `2026-06-14`).
  - `TestMCP_LastUse`: the first call sets `last_used_at`; another within the minute leaves it; once the test has put `last_used_at` two minutes back in the database (the clock of `mcpauth` is out of reach of this package), the next call moves it. The minute itself is tested by `TestMCPTokens_TouchAtMostOncePerMinute`.
  - `TestMCP_TokenIsNotLogged`: `app.Settings().Logs.MaxDays = 5` and `Logs.MinLevel = -4` (Debug); a call with a good token, one with a malformed token, one with a wrong secret; `testutil.RequestLogs`; no entry holds the tokens, their secrets or their hashes; the `POST /mcp` entry has `meta.mcpToken` = the token id and `meta.mcpTools` naming `whoami`; an entry has the user agent `prends-ton-dossard-mcp`.
  - `TestMCP_AbsentOnTheDemo`: with `DEMO_LOGIN_EMAIL`, `POST /mcp` with a token made in the database → 404.
  - `TestInner_RunsTheRulesAndHooks`: in an `ApiScenario` whose `BeforeTestFunc` registers a test route that uses `innerAPI{router: e.Router}` with a caller: as Alice, `POST /api/collections/participations/records` for Sam on FLyon (Sam is on F15 already) → `added_by` = Alice's runner, `confirmed` false; for herself on FLyon → `confirmed` true; as Bob, `PATCH` Alice's confirmed P1 → `*apiError{Status: 404}`; as Alice, `POST /api/collections/events/records` → `created_by` = Alice's runner; as Alice, `sendForm` `PATCH runners/<alice>` with an `avatar` file (`testutil.PNG`) → the record has a photo.
  - `TestInner_ForwardsTheClientAddress`: the caller has `X-Forwarded-For: 198.51.100.9`; a test route answers `e.RealIP()` → `198.51.100.9`.
  - `TestMessages_KnownCodes`: every key of the messages is a code of `../apperr/codes.go` (read like `TestCodes_FrontEndContract`) or one of PocketBase's `validation_*` codes; no message is empty.
  - `TestMessages_SameWordsAsTheSite`: read the `errors: {…}` block of `web/src/i18n/fr.ts` (as `TestTexts_SameWordsAsTheSite` of `wording` does) and compare each code that the Go messages share with it, text for text; the two `gpx` messages are compared with `fr.format.gpxNotGpx` and `fr.format.gpxTooBig`.
  - `TestPackage_NoDirectWrites`: no non-test `.go` file of the package matches `\.(Save|SaveNoValidate|Delete|DeleteWithContext|RunInTransaction|DB|NonconcurrentDB|AuxDB)\(`.
  - webdist: `TestSPA_WellKnownAndMcpAreNotTheApp`: `GET /.well-known/oauth-protected-resource` and `GET /mcp` (no route: setup does not register the MCP in that test) → 404 JSON, not `index.html`.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ ./server/webdist/ 2>&1 | tail -5
  ```

  Expected: `FAIL` (`no required module provides package github.com/modelcontextprotocol/go-sdk/mcp` before the `go get`, then the undefined symbols).
- [ ] **Step 3: implement.** Add the dependency, check the `go.mod` diff (Global Constraints), then the package and the webdist change.
- [ ] **Step 4: run them, see them pass.**

  ```bash
  go test ./server/mcp/ ./server/webdist/ ./server/setup/ ./server/accounts/ ./server/invitations/
  git diff --stat go.mod
  ```

  Expected: `ok  	courses/server/mcp`, `ok  	courses/server/webdist`, `ok  	courses/server/setup`, `ok  	courses/server/accounts`, `ok  	courses/server/invitations`; `go.mod` gains exactly the six modules of the Global Constraints.
- [ ] **Step 5: full checks**, all green, and `go build ./server` (it compiles on a fresh checkout: `//go:embed all:dist` takes the `.gitkeep`).
- [ ] **Step 6: commit.**

  ```bash
  git add go.mod
  git add go.sum
  git add server/mcp/route.go
  git add server/mcp/limit.go
  git add server/mcp/server.go
  git add server/mcp/inner.go
  git add server/mcp/messages.go
  git add server/mcp/schema.go
  git add server/mcp/tool_whoami.go
  git add server/mcp/mcp_test.go
  git add server/mcp/route_test.go
  git add server/mcp/limit_test.go
  git add server/mcp/inner_test.go
  git add server/mcp/messages_test.go
  git add server/mcp/nowrites_test.go
  git add server/mcp/export_test.go
  git add server/testutil/logs.go
  git add server/invitations/invitations_test.go
  git add server/accounts/hooks.go
  git add server/accounts/admin.go
  git add server/setup/setup.go
  git add server/webdist/spa.go
  git add server/webdist/spa_test.go
  git commit -m "feat: le serveur MCP sur /mcp, au nom du propriétaire du jeton" -m "Chaque outil passe par l'API du site, dans le même processus, avec une session de 60 secondes de la personne : les règles et les hooks du site décident. 300 requêtes par minute et par jeton." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 4: Reading races: `list_runners`, `list_race_types`, `search_events`, `get_event`

**Files:**
- Create `server/wording/words.go` and `server/wording/words_test.go` by moving `server/calendar/texts.go` and `server/calendar/texts_test.go` (`git mv`, then export what the two packages use: `Of`, `StatusText`, `RaceName`, `Deadline()` and the separator `Separator`); `words_test.go` becomes `package wording` and still reads the unexported fields it reads now; modify `server/calendar/entries.go` and `server/calendar/routes.go` to use it. No change of behaviour: the other calendar tests (`feed_test.go`, `routes_test.go`, `fold_test.go`) pass unchanged.
- Create `server/mcp/resolve.go` (+ `resolve_test.go`), `server/mcp/views.go`, `server/mcp/tools_read.go`, `server/mcp/tools_read_test.go`; modify `server/mcp/server.go`, `server/mcp/route_test.go` (`wantMemberTools` and `wantHints` gain the four), `server/mcp/export_test.go` (`ResolveRunner`, `ResolveRaceType` and the record types they take, for `resolve_test.go`).

**Interfaces:**

```go
package wording

// Words are the texts of the site in one language, for what is read away from it (the
// calendar feed, the MCP tools). The same ones as web/src/i18n (the test reads them).
type Words struct{ /* the fields of calendar's words, unchanged */ }
func Of(lang string) Words // French for a language the site does not speak
func (w Words) Status(status string) string                // "Inscrit"
func (w Words) StatusText(status string, confirmed bool) string
func (w Words) RaceName(name, typeLabel string, distanceKm float64, durationMin, timeLimitMin int) string
func (w Words) Deadline() string
// Fold writes a text in lower case without the French accents, a hyphen, an apostrophe
// or an underscore becoming a space: the letters of 9i_race_type_measures.go.
func Fold(s string) string
// Separator joins the parts of a title or of a status (" · "), as calendar's `separator` did.
const Separator = " · "
```

```go
package mcp

// EVENT_EXPAND of the site, as it is. What the event page reads besides (its comments, its
// offers with their places) is asked by eventView, in requests of its own.
const eventExpand = "formats_via_event.race_type,participations_via_event.runner,participations_via_event.added_by"

func (t *tools) runners(ctx context.Context) ([]runnerRecord, error)     // GET runners, perPage 500, sort name
func (t *tools) raceTypes(ctx context.Context) ([]raceTypeRecord, error) // GET race_types, perPage 500, sort label
// resolveRunner and resolveRaceType take an id or a name (Fold, exact); unknown → a tool
// error that lists the names. resolveRunner("") is the caller's runner.
func resolveRunner(all []runnerRecord, idOrName, me string) (runnerRecord, error)
func resolveRaceType(all []raceTypeRecord, idOrName string) (raceTypeRecord, error)
func (t *tools) eventView(ctx context.Context, id string) (eventView, error) // the event with eventExpand, its comments (sort created), its offers (expand owner) and their places (expand runner, added_by)
func (t *tools) eventViews(ctx context.Context, filter, sort string) ([]eventView, error) // pages of 200, without comments and offers
func (v eventView) detail(cfg config.Config, w wording.Words) eventDetail      // the get_event output
func (v eventView) summary(cfg config.Config, w wording.Words, me string) eventSummary

// The shapes of spec § 6.4 that several tools share, defined here, once, in views.go, and
// reused as they are by Tasks 5 to 9 (none of them defines them again):
type runnerRef struct{ /* id, name */ }
type eventRef struct{ /* id, name, url */ }
type participationOut struct{ /* PARTICIPATION: id, runner (runnerRef), status, status_label, confirmed, added_by (runnerRef), result */ }
type offerOut struct{ /* OFFER: … and its members, with their place_id and added_by */ }
```

- Tools (spec § 6.4): `list_runners` (`query`), `list_race_types`, `search_events` (`query`, `period`, `from`, `to`, `runner`, `race_type`, `limit`), `get_event` (`event_id`).
- `search_events` asks the API what the site asks (`eventsFilter` of `web/src/features/events/api.ts`): `upcoming` = `start_date >= '<today>' || end_date >= '<today>'`, sort `start_date`; `past` = `start_date < '<today>' && (end_date = '' || end_date < '<today>')`, sort `-start_date`; a range = `start_date <= '<to>' && (end_date >= '<from>' || start_date >= '<from>')`. Then in Go: `query` (Fold on name and location), `runner` (a participation that is not `dns`), `race_type` (a format of that type), `limit`, `truncated`.
- `get_event` adds `track_url` (`<APP_URL>/api/files/formats/<id>/<gpx>`), `rides`, `lodgings` (`OFFER` of spec § 6.4, complete here: Task 8 does not touch it) and `comments`. A comment is `edited` as the site says it (`isEdited` of `features/comments/api.ts`, ported): `updated` is more than one second after `created`, since PocketBase dates the two a millisecond apart on creation.
- Runner outputs never carry `user`: only `has_account`, `is_me` and `url`.

**Steps:**

- [ ] **Step 1: write the failing tests** (the `wording` tests are the moved calendar ones, plus `TestFold` and `TestRaceName`: the cases of `formatName.test.ts`, « Trail 42,2 km », « Route 6h », « Backyard max 48h », a name that was typed, the type alone).
  - `TestTools_ListRunners`: Admin, Alice, Bob, Sam in that order; `has_account` false for Sam; `is_me` for the caller only; `query: "AL"` → Alice.
  - `TestTools_ListRaceTypes`: the six types; `Trail` has `["distance","elevation","time_limit"]`; a type without measures gives the four.
  - `TestTools_SearchEvents` (with `SetNow`): on 2026-06-14 (Paris) both fixture events are `upcoming` (Event ends that day); on 2026-06-15, Event is `past` and Event2 `upcoming`; `query: "cretes"` finds « Trail des Crêtes »; `runner: "Sam"` → Event only, and none once Sam's P3 is `dns`; `race_type: "Route"` → Event2; `from`/`to` around 2026-06-14; `limit: 1` → `truncated: true`; `mine` holds Alice's P1 for Alice's token; `participants` does not count a `dns`.
  - `TestTools_GetEvent`: titles « Trail 42 km » and « Trail 15 km »; F42's participants (Alice registered and confirmed; Bob interested, not confirmed, added by Alice) with `status_label`; `day` of F15 is the start date; `url` = `http://localhost:5173/evenements/<id>`; `created_by` Alice; an event-level `interested` participation lands in `undecided`, a `supporter` in `supporters`; a comment and a ride with a passenger (made in the database) appear with their authors, the comment not `edited`, and one whose `updated` is put two seconds after its `created` `edited` (the cases of `isEdited`); a GPX on F42 (made with `testutil.GPX`) gives a `track_url`; an unknown id → `isError` with « Introuvable : il a peut-être été supprimé. ».
  - `TestTools_ReadsHoldNoSecret`: the bodies of the four tools and of `whoami` hold no `@`, no `email`, no `token_hash`, no `credential`, no `"user"` key.
  - `TestResolve`: by id, by name in another case, with accents folded (`"Crete"` vs a type « Crête » made in the test), empty runner = me, unknown → the message lists the names.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/wording/ ./server/calendar/ ./server/mcp/ 2>&1 | tail -5
  ```

  Expected: `FAIL` (`package courses/server/wording is not in std`, then unknown tools).
- [ ] **Step 3: implement** (move first with `git mv`, run `go test ./server/calendar/` green, then the tools).
- [ ] **Step 4: run them, see them pass** (same command). Expected: `ok` for the three packages.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.** The move was made with `git mv server/calendar/texts.go server/wording/words.go` and `git mv server/calendar/texts_test.go server/wording/words_test.go`, which stages the rename; stage the files again once edited:

  ```bash
  git add server/wording/words.go
  git add server/wording/words_test.go
  git add server/calendar/entries.go
  git add server/calendar/routes.go
  git add server/mcp/resolve.go
  git add server/mcp/resolve_test.go
  git add server/mcp/views.go
  git add server/mcp/tools_read.go
  git add server/mcp/tools_read_test.go
  git add server/mcp/server.go
  git add server/mcp/route_test.go
  git add server/mcp/export_test.go
  git commit -m "feat: le serveur MCP lit les coureurs, les types et les courses" -m "Les mots du flux d'agenda passent dans un paquet wording, partagé avec le serveur MCP." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 5: Reading the home page, a runner and the stats: `home`, `get_runner`, `get_stats`

**Files:**
- Create `server/mcp/home.go` (+ `home_test.go`), `server/mcp/runners.go` (+ `runners_test.go`), `server/mcp/stats.go` (+ `stats_test.go`); modify `server/mcp/server.go`, `server/mcp/route_test.go` (`wantMemberTools` and `wantHints` gain the three), `server/mcp/tools_read_test.go` (`TestTools_ReadsHoldNoSecret` covers them), `server/mcp/export_test.go` (`PendingOf`, `TodosOf`, `ToEnterOf`, `TotalsOf`, `ByRunner`, `ByYear`, `Excerpt` and the row types they take).
- Modify `server/wording/words.go` and `server/wording/words_test.go`: the result of a participation as the site writes it (`RaceTime`, `Ordinal`, `ResultParts`).

**Interfaces:**

```go
// Ports of the front (each comment names the TS function):
// pendingOf (features/home/pending.ts), todosOf (features/home/registrationTodo.ts),
// toEnterOf and isResultToEnter (features/results/resultsToEnter.ts, 60 days),
// totalsOf, byRunner, byYear and toResultRow (features/stats/stats.ts), the blocks
// MyUpcoming, GroupSoon (5 events) and LatestComments (5, excerpt of 140 cut at a word:
// features/comments/excerpt.ts).
func pendingOf(rows []participationRow, today string) []participationRow
func todosOf(rows []participationRow, today string) []registrationTodo
func toEnterOf(rows []participationRow, today string) []participationRow
func totalsOf(rows []resultRow) totals
func byRunner(rows []resultRow, year int) []runnerTotals
func byYear(rows []resultRow) []yearTotals
func excerpt(body string, max int) string
```

```go
// server/wording — what the site writes of a result, ported from lib/format.ts (raceTime,
// ordinal) and features/results/resultText.ts (resultParts), in the language of the Words.
// Narrow style, no space between a number and its unit, a unit that is zero left out but
// for the minutes between hours and seconds: "4h 12min 30s", "1h 0min 5s", "100h 30min", "59s";
// in English "4h 12m 30s".
func (w Words) RaceTime(seconds int) string
// "1er", "2e", "12e" in French; "1st", "2nd", "3rd", "4th", "11th" in English.
func (w Words) Ordinal(n int) string
// The parts of a result, to be joined with Separator: the time, the rank with the number
// ranked when it is known ("12e sur 340", "12e"; "12th out of 340"), then the note, trimmed;
// none for a part that is not given (0 and "").
func (w Words) ResultParts(finishTimeS, rank, rankOf int, note string) []string
```

- `home`: the inner requests the home page makes (its participations with `expand=event,format.race_type,added_by,runner`, the upcoming events with `eventExpand`, the 5 latest comments with `expand=event,author`), then the ports. Output of spec § 6.4.
- `get_runner` (`runner`, default me): the runner, its participations (`expand=event,format.race_type`), the upcoming ones (not `dns`), `years` (`byYear`), `history` (finished and dnf, newest first, with the result written as the site does: the status label, then `Words.ResultParts`, joined with `Separator`).
- `get_stats` (`year`, default the current year in Paris): the participations of that year that have a result, `byRunner`, sorted by km then name.

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `home_test.go`: one Go test per case of `pending.test.ts`, `registrationTodo.test.ts`, `resultsToEnter.test.ts` (named after them: `TestPendingOf_…`, `TestTodosOf_…`, `TestToEnterOf_…`), on plain rows; `TestExcerpt` (the cases of `excerpt.test.ts`); `TestTools_Home` (with `SetNow` 2026-06-01): Bob's `to_confirm` holds P2 (added by Alice); Alice's `registrations_to_do` holds an `interested` participation of hers on an event with a deadline of 2026-06-05 (made in the test), with `days_left` 4, and not once the deadline is past; `results_to_enter` holds Alice's P1 on 2026-06-20 and not on 2026-08-20; `my_upcoming` skips a `dns`; `group_soon` has at most 5 events and skips one whose only participants are supporters; `latest_comments` has the 5 newest with their excerpt.
  - `stats_test.go`: one Go test per case of `stats.test.ts`; `TestTools_GetStats`: a finished P1 with 4:12:30 and a dnf (made in the test) → Alice 1 finished, 42 km, 2400 m, 15150 s; Bob 1 dnf only; another year → empty.
  - `words_test.go` (`wording`): `TestRaceTime`, `TestOrdinal`, `TestResultParts`, the cases of `format.test.ts` (`raceTime`: `4h 12min 10s`, `1h 0min 5s`, `100h 30min`, `42min`, `59s`; `ordinal`: `1er`, `2e`, `12e`, `1st`, `2nd`, `12th`) and of `resultText.test.ts` (`resultParts`), in French and in English, named after them; and the sync test reads the word of `rankText` (« sur », « out of ») in `fr.ts` and `en.ts`.
  - `runners_test.go` — `TestTools_GetRunner`: Alice's `years` and `history` (the result written « Terminé · 4h 12min 30s · 12e sur 340 »), `upcoming` without `dns`; `runner: "Sam"`; no runner given → me; unknown → the list of names.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ -run 'TestPendingOf|TestTodosOf|TestToEnterOf|TestExcerpt|TestTotalsOf|TestByRunner|TestByYear|TestTools_(Home|GetStats|GetRunner|ReadsHoldNoSecret)|TestMCP_ToolsList' 2>&1 | tail -5
  ```

  Expected: `FAIL` (undefined ports, unknown tools); and `go test ./server/wording/` fails on `RaceTime`, `Ordinal`, `ResultParts`.
- [ ] **Step 3: implement** (the ports first, with their tests green, then the tools).
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/mcp/ ./server/wording/ ./server/calendar/`). Expected: `ok  	courses/server/mcp`, `ok  	courses/server/wording`, `ok  	courses/server/calendar`.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/home.go
  git add server/mcp/home_test.go
  git add server/mcp/runners.go
  git add server/mcp/runners_test.go
  git add server/mcp/stats.go
  git add server/mcp/stats_test.go
  git add server/mcp/server.go
  git add server/mcp/route_test.go
  git add server/mcp/tools_read_test.go
  git add server/mcp/export_test.go
  git add server/wording/words.go
  git add server/wording/words_test.go
  git commit -m "feat: le serveur MCP lit l'accueil, la page d'un coureur et les statistiques" -m "Les blocs de l'accueil et les totaux sont calculés comme dans le site, dont les fonctions sont portées en Go avec leurs cas de test." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 6: Confirmations, and races and formats: `create_event`, `update_event`, `delete_event`, `add_format`, `update_format`, `delete_format`

**Files:**
- Create `server/mcp/confirm.go` (+ `confirm_test.go`): the store and `guard` (spec § 6.13).
- Create `server/mcp/plan.go` (+ `plan_test.go`), `server/mcp/duplicates.go` (+ `duplicates_test.go`), `server/mcp/tools_events.go`, `server/mcp/tools_events_test.go`, `server/mcp/tools_formats.go`, `server/mcp/tools_formats_test.go`, `server/mcp/confirmations_test.go`.
- Modify `server/mcp/server.go`, `server/mcp/route.go` (the store is made in `Register`, outside `OnServe`, with the clock `func() time.Time { return now() }`, so that it outlives a request of `ApiScenario` and follows `SetNow`; the log meta gains, per tool, `asked` or `confirmed`), `server/mcp/export_test.go` (`NewConfirmations`, `PlanBatch`, `SignificantWords`, `EventEndDate`, `IsLongEvent`, `Shortens` and the types they take: `EventDraft`, `FormatDraft`, `StoredEvent`, `BatchOp`), `server/mcp/route_test.go` (`wantMemberTools` and `wantHints` gain the six tools).

**Interfaces:**

```go
// confirm.go — spec § 6.13.
const (
	confirmTTL      = 10 * time.Minute
	confirmPerToken = 20   // waiting confirmations per MCP token; the oldest goes beyond
	confirmTotal    = 1000 // in all
)

// confirmations keeps the confirmations waiting for their second call, in memory, like
// passkeys.Sessions: one instance runs, a confirmation lives 10 minutes, and one that a
// restart loses is only asked again.
type confirmations struct {
	now     func() time.Time
	mu      sync.Mutex
	entries map[string]pendingConfirmation
	spent   map[string]time.Time // spent tokens, until they would have expired: "already used"
}
type pendingConfirmation struct {
	userID, tokenID, tool string
	args, state           string // hex SHA-256 of the normalized arguments, and of the state shown
	made, expires         time.Time
}
func newConfirmations(now func() time.Time) *confirmations // Register gives it func() time.Time { return now() }
func (s *confirmations) put(p pendingConfirmation) (token string, expires time.Time) // "cfm_" + rand.Text(); sweeps the expired, applies the caps
// take removes token whatever happens, and returns why it does not fit p ("" when it does):
// "unknown", "used", "expired", "other" (another user, MCP token, tool or arguments),
// "changed" (state).
func (s *confirmations) take(token string, p pendingConfirmation) (refusal string)

// risk is what a call would destroy or overwrite: the French message and lines shown, and
// the records they were read from (collection, id, updated), which make the state hash.
type risk struct {
	Message string
	Details []string
	Records []stamp
}

// confirmationOut is the "confirmation" of a write tool's answer when done is false.
type confirmationOut struct {
	Token     string   `json:"token"`
	ExpiresAt string   `json:"expires_at"`
	Message   string   `json:"message"`
	Details   []string `json:"details"`
}

// guard is what every write tool calls once it has read what it needs, before any write
// (Global Constraints, « The pattern of a write tool »).
func (t *tools) guard(ctx context.Context, tool string, args any, r *risk, given string) (proceed bool, out *confirmationOut, notice string, err error)
```

`guard`:

| `given` | risk | token check | result |
|---|---|---|---|
| empty | none | — | proceed |
| empty | some | — | `put`, answer the confirmation (nothing written) |
| a token | any | fits (user, MCP token, tool, `args`, state of `r`, not expired, unused) | proceed (the token is spent) |
| a token | some | does not fit | nothing written; `notice` = the reason (« Confirmation refusée : elle a expiré. » / « … elle a déjà servi. » / « … elle ne correspond pas à cette demande. » / « … elle est inconnue (le site a peut-être redémarré). » / « … la situation a changé depuis. »), and a new confirmation |
| a token | none | does not fit | nothing written; « Cette demande n'a plus besoin de confirmation : rappelle-la sans confirmation. » |

```go
// plan.go — the form of the site, in Go (web/src/features/events/formDraft.ts and saveEvent.ts).
type formatDraft struct {
	ID, Name, RaceType, RouteURL, Date string
	DistanceKm, PriceEur               float64
	DurationMin, TimeLimitMin, ElevationGainM int
}
type eventDraft struct {
	ID, Name, Location, StartDate, EndDate, RegistrationURL, RegistrationDeadline, Notes string
	Formats []formatDraft
	Join    *joinDraft // creation only: {FormatIndex int; Status string}
}
type storedEvent struct{ ID, StartDate, EndDate string; Formats []formatDraft }
type batchOp struct {
	Method, URL string
	Body        map[string]any
	Target      string // "event", "format", "removal", "participation"
	Format      int    // index in eventDraft.Formats, -1 otherwise
}

func eventEndDate(start string, formatDates []string) string // "" when no day is after the start
func isLongEvent(start, end string) bool                      // more than 14 days
// planBatch is buildBatch: delete the removed formats, update the kept ones (date only when
// the stored event has that day), update the event, then the late dates and the new formats,
// then the participation of Join. New ids come from core.GenerateDefaultRandomId().
// One difference: a kept format whose fields are all unchanged gets no op, so that a tool
// never writes back stale values over another person's change (spec § 6.5).
func planBatch(draft eventDraft, stored *storedEvent, myRunnerID string) (ops []batchOp, eventID string, formatIDs []string)

// duplicates.go — significantWords of web/src/features/events/duplicates.ts, and its search in
// two steps: the API is asked for the events that start within 30 days of start (the days are
// checked with events.ParseDay; the name never goes into the filter, see the Global constraints),
// then Go keeps those, but exceptID, whose lower-cased name contains one of the words. A name
// with no word of four letters asks nothing.
func significantWords(name string) []string
func (t *tools) duplicates(ctx context.Context, name, start, exceptID string) ([]eventSummary, error)
```

- Races and formats are written with one `POST /api/batch` (`{"requests":[{"method","url","body"}]}`); `delete_event` with one `DELETE`. A refused batch: the tool gives `describe` a `subject` built from `batchOp.Target`/`Format` and the titles of the formats (« Épreuve 2 (« Trail 15 km »), date de l'épreuve : … »).
- Risks (spec § 6.13): `create_event` — duplicates; `update_event` — a filled field cleared, non-empty notes replaced, the end moving earlier or vanishing (`shortens` of `formDraft.ts`, ported: no end any more, or one earlier than the stored one), the day of a format that has participants changing (its own date, or the start for an undated format); `update_format` — the same for one format; `delete_event`, `delete_format` — always.
- Announced refusals: `delete_event` / `delete_format` by somebody who is neither the race's author nor an admin; the last format of a race; no format; more than 20; unknown race type; `join.format_index` out of range.
- Inputs: `update_*` fields are pointers with `omitempty` (absent = unchanged); `""`/`0` clears. `update_event.formats` is a list of format patches (`format_id` required), applied in the same batch. `update_format` is `update_event` with one patch.
- Warnings: `isLongEvent` → « Plus de deux semaines : vérifie les dates des épreuves. ».

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `confirm_test.go` — `TestConfirmations_Store` (with an injected clock): `put` then `take` with the same binding → `""`; a second `take` → `used`; after 10 min 1 s → `expired`; another user, MCP token, tool, `args` or `state` → refused, and the token is spent all the same; an unknown token → `unknown`; the 21st waiting confirmation of one MCP token drops the oldest; the 1001st in all too; the token matches `^cfm_[A-Z2-7]{26}$`.
  - `plan_test.go`: one Go test per `buildBatch` case of `web/src/features/events/saveEvent.test.ts` (« creation », « modification », « the dates of the event and of its formats move together », without the GPX and the client mocks), named after them (`TestPlan_Creation_EventFormatsThenMyParticipation`, `TestPlan_Modification_RemovedFormatsGoFirst`, `TestPlan_DatesMoveTogether_PostponeTwoDayEvent`, …), with kept formats that change (a case where the TS test sends an unchanged kept format expects no op for it in Go); `TestPlan_UnchangedFormatsAreNotSent`; `TestEventEndDate` with the cases of `formDraft.test.ts`; `TestIsLongEvent`; `TestShortens` (the cases of `shortens`: no end any more, an earlier end, a later end, nothing stored).
  - `duplicates_test.go`: `significantWords` (accents kept, figures dropped, apostrophes split); the 30-day window; the name is matched in Go (a lower-cased name that contains a word, one that does not, the edited event left out), and a name with no word of four letters makes no request.
  - `TestTools_CreateEvent`: as Alice, two formats (one dated the next day) and `join` → written at once, `done: true`, `end_date` = that day, `created_by` Alice, both formats, Alice's participation confirmed; `summary` and `url`; unknown race type → the list of types; a format without measure → « Épreuve 1 … distance : Indique au moins une distance, une durée ou un temps max. (format_measure_required) »; `registration_deadline` after the start → its message; a format dated before the start → `format_date_out_of_range`; no formats, 21 formats → refused; a format dated three weeks later → the long-event warning.
  - `TestTools_UpdateEvent`: Bob edits Alice's race (any member may) → written at once, `created_by` stays Alice; absent fields unchanged; renaming writes no format (`updated` of F42 and F15 unchanged).
  - `TestTools_UpdateEvent_MovesTheRaceWithItsFormats`: Event (13–14 June, F42 dated the 14th) moved to 20 June with `formats: [{format_id: F42, date: "2026-06-21"}]` → a confirmation first (F42 has participants), then with it, in one call: Event 20–21, F42 on the 21st, F15 (undated) on the 20th.
  - `TestTools_UpdateFormat_MovesTheEndInOneCall` (Alice): F42 to 2026-06-16 → a confirmation (participants), then end 16th; `race_type: "Cross"` → written at once; `distance_km: 0` with no other measure → refused.
  - `TestTools_AddFormat`: Bob (not the author) adds a format on 2026-06-15 to Alice's race → written at once (`formats.create`: any member), Event ends on the 15th.
  - `TestTools_DeleteFormat`: Bob on Alice's F15 → « Seule la personne qui a créé la course, Alice, ou un admin peut supprimer une de ses épreuves. », no confirmation asked; Alice on F42 → a confirmation naming Alice and Bob, nothing deleted; with it → F42 and its participations gone, end recomputed; the last format of Event2 (Bob's) → refused; the admin on F15 of Alice's race → a confirmation, then deleted.
  - `TestTools_DeleteEvent`: Bob on Alice's Event → the author refusal; Alice → a confirmation naming the formats, the participants and the counts of comments and offers (one of each made in the test), nothing deleted; with it → the race and everything under it gone; the admin on Bob's Event2 → confirmation, then gone.
  - `confirmations_test.go` (through `callTool`):
    - `TestTools_Confirmation_NothingWrittenFirst` (a table that later tasks extend): for each risk of `create_event` (a duplicate of « Trail des Crêtes » near 2026-06-13), `update_event` (notes cleared, notes replaced, an old race shortened, the start moved with participants), `update_format` (a field cleared, the day moved with participants), `delete_event`, `delete_format`: `done: false`, a token, a message naming what would be lost, **no inner request other than `GET`** (the counting hook) and the database unchanged.
    - `TestTools_Confirmation_WritesOnce`: the duplicate `create_event` with its token → one new race; the same call again with the same token → refused (« … elle a déjà servi. »), still one new race, and a fresh confirmation in the answer.
    - `TestTools_Confirmation_Expired`: `SetNow` 10 min 1 s later → refused (« … elle a expiré. »), nothing written, a fresh confirmation.
    - `TestTools_Confirmation_OtherArguments`: the token of `delete_format` F15 on F42 → refused; of `delete_format` on `delete_event` → refused; Alice's token used by Bob → refused; Alice's token used through another of Alice's MCP tokens → refused; nothing written each time.
    - `TestTools_Confirmation_StateChanged`: a confirmation for `delete_format` F42; Sam added to F42 meanwhile (in the database); the token → refused (« … la situation a changé depuis. »), the fresh confirmation names Sam, F42 is still there.
    - `TestTools_Confirmation_NoLongerNeeded`: a confirmation for clearing the notes of Event; the notes cleared meanwhile by somebody else; the token → « Cette demande n'a plus besoin de confirmation : rappelle-la sans confirmation. », nothing written.
  - `TestMCP_ToolsList`: `wantMemberTools` has the six new tools, `wantHints` their rows; `update_event` and `update_format` have `idempotentHint`; all six but `add_format` have `destructiveHint`.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ -run 'TestConfirmations|TestPlan|TestEventEndDate|TestIsLongEvent|TestShortens|TestSignificantWords|TestTools_(CreateEvent|UpdateEvent|DeleteEvent|AddFormat|UpdateFormat|DeleteFormat|Confirmation)|TestMCP_ToolsList' 2>&1 | tail -5
  ```

  Expected: `FAIL` (undefined `newConfirmations`, `planBatch`; unknown tools).
- [ ] **Step 3: implement** (the store and `guard` first, with their tests green, then the planner, then the tools).
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/mcp/`). Expected: `ok  	courses/server/mcp`.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/confirm.go
  git add server/mcp/confirm_test.go
  git add server/mcp/plan.go
  git add server/mcp/plan_test.go
  git add server/mcp/duplicates.go
  git add server/mcp/duplicates_test.go
  git add server/mcp/tools_events.go
  git add server/mcp/tools_events_test.go
  git add server/mcp/tools_formats.go
  git add server/mcp/tools_formats_test.go
  git add server/mcp/confirmations_test.go
  git add server/mcp/export_test.go
  git add server/mcp/server.go
  git add server/mcp/route.go
  git add server/mcp/route_test.go
  git commit -m "feat: créer, modifier et supprimer une course et ses épreuves par le serveur MCP" -m "Ce qui supprime ou efface ne se fait qu'au second appel, avec le jeton de confirmation de la réponse au premier : une fois, dix minutes, pour ces arguments et la situation montrée." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 7: Participations and results: `add_participation`, `update_participation`, `remove_participation`, `set_result`

**Files:**
- Create `server/mcp/tools_participations.go`, `server/mcp/tools_participations_test.go`, `server/mcp/tools_results.go`, `server/mcp/tools_results_test.go`, `server/mcp/rules_test.go`; modify `server/mcp/server.go`, `server/mcp/confirmations_test.go`, `server/mcp/route_test.go` (`wantMemberTools` and `wantHints` gain the four), `server/mcp/export_test.go` (`ParseFinishTime`).

**Interfaces:**

```go
// participationOut and eventRef are the ones of Task 4 (views.go); the result is written with
// wording.Words.ResultParts (Task 5).
type participationResult struct {
	Done          bool              `json:"done"`
	Confirmation  *confirmationOut  `json:"confirmation,omitempty"`
	Participation *participationOut `json:"participation,omitempty"`
	Event         *eventRef         `json:"event,omitempty"`
	FormatTitle   string            `json:"format_title,omitempty"`
	Summary       string            `json:"summary,omitempty"`
}
// parseFinishTime reads "h:mm:ss" (and "mm:ss" under an hour) into seconds.
func parseFinishTime(s string) (int, error)
```

- `add_participation` (`runner` optional, default me; `event_id` required without `format_id`; `format_id`; `status` required, enum of the six; `confirmation`): pre-checks of spec § 6.6 (single-format event, existing participation found by an inner list on `(runner, format)` or `(runner, event, format = '')` to give its id); risk: it would replace the event-level participation of a runner who is not the caller; `guard`; `POST /api/collections/participations/records` `{runner, event, format, status}`. The `summary` says « non confirmé : <name> le verra dans « À confirmer » » when `confirmed` is false and the runner has an account, « <name> n'a pas de compte : sa participation reste non confirmée » when not, and the replacement for one's own.
- `update_participation` (`participation_id`; `status`, `format_id` optional; `confirmation`): reads the participation (expand `runner`) first; with neither field and a caller who is not the runner → « Seule la personne concernée, <name>, peut confirmer sa participation. »; announced refusal for a member on a confirmed participation of somebody else; risk: somebody else's participation, or a status that would clear a result (what `clearResult` of the participations package drops); `guard`; `PATCH` with what is given (`{}` to confirm one's own).
- `remove_participation` (`participation_id`, `confirmation`): reads it; the same announced refusal; risk: always; `guard`; `DELETE`.
- `set_result` (`participation_id`, `status` `finished`|`dnf`, `finish_time`, `rank`, `rank_of`, `note`, `confirmation`): a participation without a format → « Choisis d'abord l'épreuve. »; the same announced refusal; risk: an existing result would be replaced, or somebody else's participation; `guard`; one `PATCH` `{status, finish_time_s, rank, rank_of, result_note}`.

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `TestTools_AddParticipation_Confirmation`: Alice adds herself (no `runner`) to FLyon → written at once, confirmed; adds `"bob"` to FLyon → written at once, not confirmed, `added_by` Alice, the `summary` names « À confirmer »; adds Sam → not confirmed, the no-account sentence.
  - `TestTools_AddParticipation` (one fresh app per case): Bob already on F42 → the message with P2's id; `interested` without format on Event2 (one format) → refused with FLyon's id and title; the admin's runner as `supporter` without format on Event → in `supporters`; `supporter` with a format → « Un supporteur ne court pas d'épreuve. »; `finished` on a format of an event in 2099 → « La course n'a pas encore eu lieu. (status_before_race) »; `format_id` of Event2 with `event_id` of Event → `format_other_event`; unknown runner → the list of names.
  - `TestTools_AddParticipation_ReplacesAnotherRunnersChoice`: the admin's runner `interested` in Event without format (made in the database); Alice adds the admin's runner to F15 → a confirmation naming the replaced participation, nothing written; with it → the format participation, the event-level one gone. Alice doing the same for herself → written at once, the `summary` says it.
  - `TestTools_UpdateParticipation_OnlyTheRunnerConfirms`: Bob's token on P2 with no field → P2 confirmed, no confirmation asked; Alice's token on P2 (not confirmed yet) with no field → « Seule la personne concernée, Bob, peut confirmer sa participation. ».
  - `TestTools_UpdateParticipation`: Alice changes Bob's unconfirmed P2 to `registered` → a confirmation (somebody else's), then with it → `registered`, still not confirmed; once Bob confirmed it, Alice → the announced refusal, no confirmation; the admin → a confirmation, then allowed; Alice on her own P1 to `dns` → written at once; Alice's P1 `finished` with a time (in the database, the race being past), then `registered` → a confirmation naming the time that would be lost; a `format_id` of another event → `format_other_event`.
  - `TestTools_RemoveParticipation`: Alice removes Sam's P3 (unconfirmed) → a confirmation, then gone; Bob's confirmed P2 by Alice → the announced refusal, still there; Bob removes his own → a confirmation, then gone; the admin removes Alice's P1 → a confirmation, then gone.
  - `TestTools_SetResult`: Alice on her P1 (June 2026, past) `finished`, `4:12:30`, 12 of 340, a note → written at once, the `summary` « Terminé · 4h 12min 30s · 12e sur 340 »; again with another time → a confirmation naming the old result, then replaced; `dnf` with a time → the time dropped (the hook), the note kept; `rank` 400 of 340 → `rank_above_total`; a race in 2099 → `status_before_race`; Alice on Bob's unconfirmed P2 → a confirmation, then written; an event-level participation → « Choisis d'abord l'épreuve. »; `TestParseFinishTime` (`4:12:30`, `0:45:00`, `45:00`, `4:60:00` refused, `abc` refused).
  - `confirmations_test.go` gains the participation and result rows in `TestTools_Confirmation_NothingWrittenFirst`, and `TestTools_Confirmation_NamesOrIds`: a confirmation asked with `runner: "bob"` is accepted on the call with Bob's id (the arguments are normalized).
  - `TestTools_FollowTheRulesOfTheOwner` (`rules_test.go`, a table that Tasks 8 and 10 extend): every member write tool of this task and of Task 6 × {Alice, Bob, Admin} on the fixture, each row the answer the site gives to the same person (allowed or refused), checked in the database after the confirmation when one is asked — the rows of the matrix of spec v1 § 6.1 for events, formats and participations (delete: author or admin; participation of somebody else: only while unconfirmed, or an admin).
  - `TestMCP_ToolsList`: the four new tools and their rows of `wantHints`: `add_participation` (it can ask to replace another's choice) and `remove_participation` destructive, `update_participation` and `set_result` idempotent and destructive.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ -run 'TestTools_(AddParticipation|UpdateParticipation|RemoveParticipation|SetResult|FollowTheRulesOfTheOwner|Confirmation)|TestParseFinishTime|TestMCP_ToolsList' 2>&1 | tail -5
  ```

  Expected: `FAIL` (unknown tools).
- [ ] **Step 3: implement.**
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/...`). Expected: `ok` everywhere.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/tools_participations.go
  git add server/mcp/tools_participations_test.go
  git add server/mcp/tools_results.go
  git add server/mcp/tools_results_test.go
  git add server/mcp/rules_test.go
  git add server/mcp/confirmations_test.go
  git add server/mcp/server.go
  git add server/mcp/route_test.go
  git add server/mcp/export_test.go
  git commit -m "feat: ajouter, changer et retirer un coureur, et saisir un résultat, par le serveur MCP" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 8: Comments, car-sharing and lodging: `add_comment`, `update_comment`, `delete_comment`, `add_offer`, `update_offer`, `delete_offer`, `offer_place`

**Files:**
- Create `server/mcp/tools_comments.go` (+ `tools_comments_test.go`), `server/mcp/tools_offers.go` (+ `tools_offers_test.go`); modify `server/mcp/server.go`, `server/mcp/confirmations_test.go`, `server/mcp/rules_test.go`, `server/mcp/route_test.go` (`wantMemberTools` gains the seven).

**Interfaces:**

- Comments (spec § 6.7): `add_comment` → `POST comments {event, body}` (`author` set by the hook; trimmed and refused when blank by the hooks of the comments package); `update_comment` → announced refusal when the caller is not the author (even an admin), then `PATCH comments/{id} {body}`; `delete_comment` → announced refusal when neither author nor admin; risk always; `DELETE`.
- Offers (spec § 6.8): `add_offer` → `POST offers {event, kind, place, seats, date, time, end_date, url, notes}` (`date` defaults to the event's start, as the site's form; `owner` set by the hook; the hooks of the offers package check seats, kind fields, dates, one per kind); `update_offer` → announced refusal for neither owner nor admin; risk: a filled field cleared, non-empty notes replaced, somebody else's offer; `PATCH` (never `event`, `kind`, `owner`: the rule refuses them); `delete_offer` → risk always (names the people with a place); `DELETE`; `offer_place` `take` → `POST offer_members {offer, runner}` (`added_by` by the hook), announced refusal when the runner is not the caller and the caller is neither the owner nor an admin; `free` → finds the place (`GET offer_members?filter=(offer='…' && runner='…')`), the same announced refusal, risk always, `DELETE offer_members/{id}`.

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `TestTools_Comments`: Alice comments Event → written at once, `author` Alice; a blank body → refused (the site's message); 2001 characters → `validation_max_text_constraint`; Alice edits hers → written at once; Bob edits Alice's → « Seule la personne qui a écrit ce commentaire, Alice, peut le modifier. »; the admin edits Alice's → the same refusal; Bob deletes Alice's → the announced refusal; Alice deletes hers → a confirmation citing the start of the text, then gone; the admin deletes Bob's → a confirmation, then gone; the body is stored as typed (HTML kept as text, line breaks kept).
  - `TestTools_Offers`: Alice offers a ride from « Lyon » with 3 seats → written at once, `owner` Alice, `date` = the start of Event; a ride without seats → `offer_seats_required`; a second ride for Alice in Event → `offer_already_member`; a lodging with `time` → the time dropped (the hook); `end_date` before `date` → `end_before_start`; Bob takes a place → written at once; Bob places Sam in Alice's ride → the announced refusal; Alice places Sam → written; the ride full → `offer_full`; Alice takes a place in her own ride → `offer_owner_member`; seats below the passengers → `offer_seats_below_members`; Alice clears her notes → a confirmation; the admin edits Alice's ride → a confirmation; Bob frees his place → a confirmation, then gone; Alice deletes her ride → a confirmation naming Bob and Sam, then gone with its places.
  - `confirmations_test.go` gains the comment and offer rows.
  - `rules_test.go` gains the comment and offer rows (author only for an edit, author or admin for a delete; owner or admin for an offer; self, owner or admin for a place) — the rows of spec v2 § 4.7.
  - `TestMCP_ToolsList`: the seven new tools and their rows of `wantHints`: `delete_comment`, `update_offer`, `delete_offer`, `offer_place` destructive; `update_comment` and `update_offer` idempotent.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ -run 'TestTools_(Comments|Offers|Confirmation|FollowTheRulesOfTheOwner)|TestMCP_ToolsList' 2>&1 | tail -5
  ```

  Expected: `FAIL` (unknown tools).
- [ ] **Step 3: implement.**
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/mcp/`). Expected: `ok  	courses/server/mcp`.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/tools_comments.go
  git add server/mcp/tools_comments_test.go
  git add server/mcp/tools_offers.go
  git add server/mcp/tools_offers_test.go
  git add server/mcp/confirmations_test.go
  git add server/mcp/rules_test.go
  git add server/mcp/server.go
  git add server/mcp/route_test.go
  git commit -m "feat: commentaires, covoiturage et logement par le serveur MCP" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 9: Files: upload slots, `start_upload`, `set_photo`, `set_track`

**Files:**
- Create `server/mcp/uploads.go` (the store, the route `PUT /api/app/mcp-uploads/{id}`, `start_upload`) and `server/mcp/uploads_test.go`; `server/mcp/gpx.go` (port of `parseGpx` and `gpxStats` of `web/src/features/route/gpx.ts`, with `withXmlDeclaration` of `saveEvent.ts`) and `server/mcp/gpx_test.go`; `server/mcp/tools_files.go` (`set_photo`, `set_track`) and `server/mcp/tools_files_test.go`.
- Modify `server/mcp/route.go` (register the upload route, not on the demo), `server/mcp/server.go`, `server/mcp/confirmations_test.go`, `server/mcp/route_test.go` (`wantMemberTools` and `wantHints` gain the three), `server/mcp/export_test.go` (`ParseGpx`, `StatsOf`, `WithXmlDeclaration`, and the upload store with its constructor and a clock, for `TestUploads_Store`).
- Modify `server/apperr/codes.go` (`CodeUploadInvalid = "upload_invalid"`), `server/apperr/apperr_test.go` (`want`: `"token_limit", "upload_invalid", "wrong_password"`), `web/src/i18n/errors.ts`, `web/src/i18n/fr.ts`, `web/src/i18n/en.ts` (« Cet envoi n'est pas valide, ou il a expiré. » / "This upload is not valid, or it has expired.").

**Interfaces:**

```go
// uploads.go — spec § 6.9.
const (
	uploadTTL       = 10 * time.Minute
	uploadPerToken  = 2
	uploadTotal     = 64 << 20 // bytes kept in all
	photoMaxBytes   = 5 << 20  // runners.avatar
	trackMaxBytes   = 10 << 20 // formats.gpx
	inlineMaxBytes  = 512 << 10 // content_base64, decoded
)
type uploadPurpose string // "photo" | "track"
type uploadSlot struct {
	id, secretHash, userID, tokenID string
	purpose                         uploadPurpose
	data                            []byte // nil until the PUT
	contentType                     string
	expires                         time.Time
}
type uploads struct{ /* mu, slots map[string]*uploadSlot, bytes int, now func() time.Time */ }
func (u *uploads) open(userID, tokenID string, p uploadPurpose) (id, secret string, expires time.Time) // "ptu_" + rand.Text(); caps
func (u *uploads) put(id, secret string, body io.Reader) error // constant-time secret check; MaxBytesReader; type; once
// peek gives the file of a slot without freeing it: only for the MCP token that opened it, and
// its purpose. A risky first call hashes the bytes for its confirmation and leaves the slot to
// the second call; a refused peek leaves it too.
func (u *uploads) peek(id, tokenID string, p uploadPurpose) (data []byte, contentType string, err error)
// take is peek, and frees the slot: it hands the file to the tool that writes it.
func (u *uploads) take(id, tokenID string, p uploadPurpose) (data []byte, contentType string, err error)
// fileInput resolves a tool's upload_id or content_base64 (exactly one) into bytes. With
// consume false (before guard) a slot is peeked; with true (once guard has let the call
// through) it is taken.
func (t *tools) fileInput(ctx context.Context, p uploadPurpose, uploadID, base64 string, consume bool) ([]byte, string, error)

// gpx.go
type trackPoint struct{ Lat, Lon, Ele float64; HasEle bool }
func parseGpx(xml []byte) ([]trackPoint, error) // trkpt, else rtept; none → error
type gpxStats struct{ Points int; DistanceKm, ElevationGainM, ElevationLossM, MinM, MaxM float64; HasElevation bool }
func statsOf(points []trackPoint) gpxStats // haversine, hysteresis of 3 m
func withXmlDeclaration(data []byte) []byte
```

- `PUT /api/app/mcp-uploads/{id}`: no session; `X-Upload-Secret` header; `http.MaxBytesReader` at the slot's limit (413 beyond); `http.DetectContentType` (photo: `image/jpeg`, `image/png`, `image/webp`; track: XML or text that `parseGpx` reads); any refusal of the slot (unknown, expired, filled, wrong secret, wrong type) → 400 `upload_invalid`, without saying which; → 204. No success logging is needed (the secret is in a header, never in the path).
- `start_upload` (`purpose`) → spec § 6.9, with `command` built for the caller's `APP_URL`.
- `set_photo` (`runner`, `upload_id` | `content_base64` | `remove`, `confirmation`): announced refusal when the runner is not the caller's and the caller is not an admin; risk: a photo exists, or somebody else's runner; `guard` (the bytes are read with `fileInput(…, false)`, which peeks: the confirmation's `args` hold their SHA-256, and the slot is taken, `fileInput(…, true)`, only once `guard` proceeds); `sendForm` `PATCH runners/{id}` with `avatar`, or, for `remove`, a JSON `PATCH runners/{id}` `{"avatar": null}` as the site does (`removeAvatar`). The site's messages for `validation_invalid_mime_type` and `validation_file_size_limit` on `avatar`.
- `set_track` (`format_id`, `upload_id` | `content_base64` | `remove`, `use_track_values`, `confirmation`): `parseGpx` (refusal « Ce fichier n'est pas une trace GPX exploitable. », nothing sent), `withXmlDeclaration`; risk: a track exists; `guard`; `sendForm` `PATCH formats/{id}` with `gpx` (and `distance_km`, `elevation_gain_m` rounded as the form does, when `use_track_values`), or, for `remove`, a JSON `PATCH formats/{id}` `{"gpx": null}` as the site does (`uploadTraces`); answers `track` (`statsOf`).

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `gpx_test.go`: one Go test per case of `web/src/features/route/gpx.test.ts` that is about parsing and stats (named after them: `TestParseGpx_…`, `TestGpxStats_…`), and `TestWithXmlDeclaration` (the cases of `saveEvent.test.ts` for it).
  - `uploads_test.go`:
    - `TestUploads_Store` (with an injected clock): open, put, `peek` twice (the slot stays, also after a refused `peek` by another token or purpose), take once; a second take → refused; another MCP token or purpose → refused; after 10 min → refused and the memory freed; a third slot for one token drops the oldest; past 64 MB in all, the oldest goes.
    - `TestUploads_Route`: `PUT` with the right secret → 204; again → 400 `upload_invalid`; a wrong secret → 400; no header → 400; a photo of 5 MB + 1 byte → 413; a text file for a photo → 400; an unknown id → 400.
    - `TestUploads_SecretIsNotLogged`: logs on (MaxDays 5, Debug); a good and a bad `PUT`; `testutil.RequestLogs`: no entry holds a secret.
    - `TestUploads_AbsentOnTheDemo`: with `DEMO_LOGIN_EMAIL` → 404.
  - `tools_files_test.go`:
    - `TestTools_StartUpload`: the answer for `photo` and `track` (limits, accepted types, a `command` with the URL and the header).
    - `TestTools_SetPhoto`: Alice sets her photo from an upload (`testutil.PNG`) → written at once (she had none), `photo_url` set, thumbs available; again → a confirmation (one exists), then replaced; `remove` → a confirmation, then none (a JSON request); from `content_base64` → written; 600 KB in base64 → refused (« … 512 Ko … : passe par start_upload. »); Alice on Bob's runner → the announced refusal; the admin on Bob's → a confirmation, then written; both `upload_id` and `content_base64` → refused; a slot of Bob's token used by Alice → `upload_invalid`; a GIF → the site's `validation_invalid_mime_type` message for the photo.
    - `TestTools_SetTrack`: Bob (any member) puts a track on Alice's F42 from an upload (`testutil.GPX`) → written at once, `track` with points and distance; a GPX without the XML declaration → accepted; `use_track_values` → F42's distance and D+ are the track's; again → a confirmation; `remove` → a confirmation; a file with no point → « Ce fichier n'est pas une trace GPX exploitable. », nothing sent (no inner write request).
  - `confirmations_test.go` gains the photo and track rows (the slot not taken by the first call, taken by the second).
  - `TestMCP_ToolsList`: the three new tools; `set_photo` and `set_track` destructive.
  - Front: `web/src/i18n/errors.test.ts` fails until `upload_invalid` has its messages.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ ./server/apperr/ -run 'TestParseGpx|TestGpxStats|TestWithXmlDeclaration|TestUploads_|TestTools_(StartUpload|SetPhoto|SetTrack|Confirmation)|TestMCP_ToolsList|TestCodes_FrontEndContract' 2>&1 | tail -5
  ```

  Expected: `FAIL` (undefined `parseGpx`, `uploads`; unknown tools; the `want` list).
- [ ] **Step 3: implement** (the GPX port first, then the store and the route, then the tools; the code in its four places).
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/...`, and `vt.sh … src/i18n/errors.test.ts`). Expected: `ok` everywhere; Vitest `Test Files  1 passed`.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/uploads.go
  git add server/mcp/uploads_test.go
  git add server/mcp/gpx.go
  git add server/mcp/gpx_test.go
  git add server/mcp/tools_files.go
  git add server/mcp/tools_files_test.go
  git add server/mcp/route.go
  git add server/mcp/server.go
  git add server/mcp/confirmations_test.go
  git add server/mcp/route_test.go
  git add server/mcp/export_test.go
  git add server/apperr/codes.go
  git add server/apperr/apperr_test.go
  git add web/src/i18n/errors.ts
  git add web/src/i18n/fr.ts
  git add web/src/i18n/en.ts
  git commit -m "feat: la photo et la trace GPX par le serveur MCP" -m "Un fichier arrive en base64 (512 Ko) ou par un envoi en deux temps : start_upload, puis un PUT avec un secret dans l'en-tête, gardé dix minutes en mémoire." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 10: Profile and settings: `rename_runner`, `passkeys`, `calendar_link`, `mcp_tokens`

**Files:**
- Create `server/mcp/tools_settings.go` (+ `tools_settings_test.go`); modify `server/mcp/server.go`, `server/mcp/confirmations_test.go`, `server/mcp/rules_test.go`, `server/mcp/route_test.go` (`wantMemberTools` gains the four: thirty-two in all).

**Interfaces:**

- `rename_runner` (`runner`, default me; `name`): announced refusal for somebody else's runner when not admin; `PATCH runners/{id} {name}` (`validation_not_unique` on a taken name, `validation_max_text_constraint` past 50).
- `passkeys` (`action`: `list` | `rename` | `delete`; `runner`; `passkey_id`; `name`; `confirmation`): `list` → `GET passkeys?filter=(user='<account of the runner>')&fields=id,name,created,last_used_at` (the account id is read with the runner, never output); for somebody else's runner, the site's rule answers an admin and gives a member an empty list, which the tool turns into the announced refusal; `rename` → `PATCH passkeys/{id} {name}` (own only, the rule); `delete` → risk always; `DELETE passkeys/{id}`. The output has no `credential`, no `credential_id`.
- `calendar_link` (`action`: `show` | `create` | `renew` | `delete`; `lang`; `confirmation`): `GET /api/app/calendar`; `create` → `POST /api/app/calendar {lang}` when none (else « Tu as déjà un lien : renew le remplace. »); `renew` → risk always, then `POST`; `delete` → risk always, then `DELETE`. The `summary` reminds that the URL lets anybody who has it read the person's races.
- `mcp_tokens` (`action`: `list` | `revoke`; `token_id`; `confirmation`): `GET /api/app/mcp-tokens` (marks `current`); `revoke` → risk always; `DELETE /api/app/mcp-tokens/{id}`; on the current token, the answer says it was the last call.
- **No tool for the theme.** Since 9j the skin is kept on the account (`users.skin`), but it is chosen from the build's own list of themes, which the server does not know (it checks the shape of an id only) and an assistant cannot know; the light or dark mode is the device's. Spec § 10 says so.

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `TestTools_RenameRunner`: Alice renames herself → written; to « bob » → `validation_not_unique`; Alice renames Bob → the announced refusal; the admin renames Sam → written.
  - `TestTools_Passkeys`: two passkeys of Alice and one of Bob (made in the database, with a `credential`); Alice `list` → hers, without `credential` nor `credential_id` in the body; `rename` hers → written; `rename` Bob's → refused; `delete` hers → a confirmation, then gone; `delete` Bob's → refused (the API's 404, explained); Alice `list` with `runner: "Bob"` → the announced refusal; the admin `list` Bob's → Bob's; the admin `delete` Bob's → a confirmation, then gone.
  - `TestTools_CalendarLink`: `show` without a link → `exists: false`; `create` → a URL ending in `.ics`, and `show` gives it again; `create` again → « Tu as déjà un lien… »; `renew` → a confirmation, then a new URL and the old feed answers 404; `delete` → a confirmation, then `exists: false`; Bob's `show` never gives Alice's URL.
  - `TestTools_McpTokens`: Alice with two tokens: `list` → both, `current` on the calling one, no secret; `revoke` the other → a confirmation, then gone, its next call → 401; `revoke` the current → a confirmation, then the answer says it was the last call, and the next call → 401; `revoke` Bob's token id → `not_found` (explained).
  - `confirmations_test.go` and `rules_test.go` gain these rows.
  - `TestMCP_ToolsList`: `wantMemberTools` has the thirty-two member tools, `wantHints` their rows: `passkeys`, `calendar_link` and `mcp_tokens` destructive (they can ask), `rename_runner` idempotent.
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ -run 'TestTools_(RenameRunner|Passkeys|CalendarLink|McpTokens|Confirmation|FollowTheRulesOfTheOwner)|TestMCP_ToolsList' 2>&1 | tail -5
  ```

  Expected: `FAIL` (unknown tools).
- [ ] **Step 3: implement.**
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/...`). Expected: `ok` everywhere.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/tools_settings.go
  git add server/mcp/tools_settings_test.go
  git add server/mcp/confirmations_test.go
  git add server/mcp/rules_test.go
  git add server/mcp/server.go
  git add server/mcp/route_test.go
  git commit -m "feat: le profil et les réglages par le serveur MCP" -m "Le nom, les clés d'accès, le lien d'agenda et les jetons d'assistant ; jamais un mot de passe, un email ni les données d'une clé." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 11: The admin tools, for an admin's token only

**Files:**
- Create `server/mcp/admin_members.go` (`admin_list_members`, `admin_create_runner`, `admin_delete_runner`, `admin_set_role`, `admin_set_disabled`), `server/mcp/admin_links.go` (`admin_create_link`, `admin_revoke_link`), `server/mcp/admin_types.go` (`admin_create_race_type`, `admin_update_race_type`, `admin_delete_race_type`), `server/mcp/admin_merge.go` (`admin_merge`), and their tests `server/mcp/admin_members_test.go`, `admin_links_test.go`, `admin_types_test.go`, `admin_merge_test.go`, plus `server/mcp/roles_test.go`.
- Modify `server/mcp/server.go` (the admin tools on the admin server only), `server/mcp/confirmations_test.go`, `server/mcp/route_test.go` (`wantAdminTools`: the eleven, and their rows of `wantHints`), `server/mcp/export_test.go` (the admin handlers, for `TestTools_AdminToolsCheckTheRole`; `MemberState`, for `TestMemberState`).

**Interfaces:**

```go
// requireAdmin starts every admin tool: for a caller who is not an admin it returns the
// error the SDK gives for a tool it does not have (v1.8.0, server.go), word for word, so
// that a wiring mistake that put an admin tool on the member server still opens nothing.
// The error is returned as it is, never wrapped: the SDK recognises a *jsonrpc.Error by a type
// assertion, and a wrapped one would become a tool error (isError) instead.
func requireAdmin(ctx context.Context, tool string) error
// → &jsonrpc.Error{Code: jsonrpc.CodeInvalidParams, Message: fmt.Sprintf("unknown tool %q", tool)}
```

Each admin tool sends the request of the admin page (`web/src/features/admin/api.ts`), through `innerAPI`, as the caller (spec § 6.11):

| Tool | Inner requests | Announced refusals | Risk (`guard`) |
|---|---|---|---|
| `admin_list_members` | `GET runners?expand=user`, `GET invitations?filter=(used_at='')`, `GET passkeys?fields=id,user` (counts), `GET participations?fields=runner` (counts) | — | — |
| `admin_create_runner` | `POST runners {name}` | — | — |
| `admin_delete_runner` | `DELETE runners/{id}` | has an account; has participations | always |
| `admin_create_link` | `POST /api/app/invitations {runnerId, kind, role}` | `invite` for a runner with an account, `reset` without | `reset` always; `invite` replacing a pending invitation, or with role `admin` |
| `admin_revoke_link` | `GET invitations?filter=(runner='…' && kind='…' && used_at='')`, `DELETE /api/app/invitations/{id}` | none pending | always |
| `admin_set_role` | `PATCH users/{id} {role}` | no account | always |
| `admin_set_disabled` | `PATCH users/{id} {disabled}` | no account | disabling |
| `admin_create_race_type` | `POST race_types {label, measures}` | — | — |
| `admin_update_race_type` | `PATCH race_types/{id} {label?, measures?}` | — | — |
| `admin_delete_race_type` | `GET formats?filter=(race_type='…')` (count), `DELETE race_types/{id}` | in use (`race_type_in_use`, with the count) | always |
| `admin_merge` | `POST /api/app/admin/merge-{kind} {keepId, mergeId, dryRun: true}`, then `dryRun: false` | `merge_same_record`, `merge_formats_different_events` (from the dry run) | always; the dry run's `MergeResult` is part of the state hash |

- `admin_list_members` never outputs an email: it reads `expand.user` only for the role and `disabled`. `state` is computed like `memberState` of `web/src/features/admin/memberState.ts` (port with its test cases).
- `admin_create_link` returns `url` and `expires_at` as the route answers them; the `summary` tells the assistant that the link opens the account and is only for that person. The URL is never logged by the package (the inner request's path is `/api/app/invitations`, the token is in the response body and the URL fragment only).
- `admin_set_disabled` on the caller's own account: written, then the answer says that this token no longer works (the hook of Task 1 deleted it); `admin_set_role` on oneself: the admin tools are gone from the next request.

**Steps:**

- [ ] **Step 1: write the failing tests.**
  - `roles_test.go`:
    - `TestMCP_MemberDoesNotSeeTheAdminTools`: Alice's (member) `tools/list` has exactly `wantMemberTools`, no name starting with `admin_`; the admin's has `wantMemberTools` + `wantAdminTools`. For each admin tool, Alice's `tools/call` with valid arguments gets a body equal, but for the tool's name, to the one of `tools/call` of `no_such_tool`: a JSON-RPC error `-32602`, message `unknown tool "admin_…"`, no `result`; nothing changed in the database (runners, invitations, users, race types, events counted and compared).
    - `TestMCP_RoleChangesAtTheNextRequest`: the admin's token lists the admin tools; a second admin is made, the first set to `member` in the database; the same token's next `tools/list` lacks them and `admin_merge` is an unknown tool; set back to `admin`, they are back. Bob promoted to `admin` in the database: his token lists them at the next request.
    - `TestTools_AdminToolsCheckTheRole`: each admin tool handler, called directly (`export_test.go`) with a member caller → the `unknown tool` error, and no inner request is made.
  - `admin_members_test.go`:
    - `TestMemberState` (the cases of `memberState.test.ts`).
    - `TestAdmin_ListMembers`: Admin, Alice, Bob active with their roles; Sam `no_account`; an invitation made for a new runner → `invited` with its expiry; a reset for Bob → `reset`; a passkey of Alice counted; `participations` counts; the body holds no `@`, no `email`, no `credential`.
    - `TestAdmin_Runners`: create « Julie » → listed; again « julie » → `validation_not_unique`; delete Julie → a confirmation, then gone; delete Sam (participations) → announced `runner_has_participations`, no confirmation; delete Bob (account) → announced `runner_has_account`.
    - `TestAdmin_SetRole`: Bob to admin → a confirmation, then `role` admin; the admin removing their own role while the only admin → a confirmation, then the site's `last_admin` refusal, role unchanged.
    - `TestAdmin_SetDisabled`: disabling Bob → a confirmation naming the closed sessions and the deleted MCP tokens; with it → disabled, Bob's MCP token refused (401) at its next call; re-enabling → written at once, no confirmation.
  - `admin_links_test.go`:
    - `TestAdmin_CreateLink`: an invitation for a new runner « Julie » → written at once (none pending, role member), `url` starts with `http://localhost:5173/invitation#`, `expires_at` 7 days ahead; again → a confirmation (it replaces the pending one), then a new URL, and the old token no longer looks up (`POST /api/app/invitations/lookup` → 404); an invitation with role `admin` → a confirmation; a reset for Bob → a confirmation, then a URL; an invitation for Bob → `invitation_kind_mismatch`; a reset for Sam → the same. The settings limit `/api/app/invitations/` to 10 requests a minute per address (the `lookup` counts too), so this test is two tests on two apps, each with fewer than 8 inner requests.
    - `TestAdmin_RevokeLink`: a confirmation, then the invitation gone; none pending → « Aucun lien en attente pour … ».
    - `TestAdmin_LinkIsNotLogged`: logs on (MaxDays 5, Debug); `admin_create_link`; `testutil.RequestLogs`: no entry holds the token of the URL or its hash.
  - `admin_types_test.go` — `TestAdmin_RaceTypes`: create « Rando » with `["distance","elevation"]` → `list_race_types` shows it; « rando » again → `validation_not_unique`; rename → done, and `get_event` of a race with a format of that type shows the new label; delete « Rando » (unused) → a confirmation, then gone; delete « Trail » (used) → announced `race_type_in_use` with the count, no confirmation.
  - `admin_merge_test.go` — `TestAdmin_Merge`: two events created in the test with participants, comments and an offer; `admin_merge` `events` → a confirmation whose details are the dry run's counts, nothing merged; a participation added meanwhile → the token refused, a new preview; with the fresh token → merged, `result` as the route answers; `formats` of two formats of Event → merged; the same id twice → `merge_same_record`; formats of two events → `merge_formats_different_events`.
  - `confirmations_test.go` gains the admin rows (with the admin's token).
  - `TestMCP_ToolsList`: `wantAdminTools` = the eleven, with their rows of `wantHints`: `admin_list_members` read-only; destructive: every admin tool but `admin_list_members`, `admin_create_runner`, `admin_create_race_type` and `admin_update_race_type` (the ones that never ask); idempotent: `admin_update_race_type`, `admin_set_role`, `admin_set_disabled` (spec § 6.1).
- [ ] **Step 2: run them, see them fail.**

  ```bash
  go test ./server/mcp/ -run 'TestMCP_(MemberDoesNotSeeTheAdminTools|RoleChangesAtTheNextRequest|ToolsList)|TestTools_(AdminToolsCheckTheRole|Confirmation)|TestMemberState|TestAdmin_' 2>&1 | tail -5
  ```

  Expected: `FAIL` (unknown tools, undefined `requireAdmin`).
- [ ] **Step 3: implement.**
- [ ] **Step 4: run them, see them pass** (same command, then `go test ./server/...`). Expected: `ok` everywhere.
- [ ] **Step 5: full checks**, all green.
- [ ] **Step 6: commit.**

  ```bash
  git add server/mcp/admin_members.go
  git add server/mcp/admin_links.go
  git add server/mcp/admin_types.go
  git add server/mcp/admin_merge.go
  git add server/mcp/admin_members_test.go
  git add server/mcp/admin_links_test.go
  git add server/mcp/admin_types_test.go
  git add server/mcp/admin_merge_test.go
  git add server/mcp/roles_test.go
  git add server/mcp/confirmations_test.go
  git add server/mcp/server.go
  git add server/mcp/route_test.go
  git add server/mcp/export_test.go
  git commit -m "feat: les outils d'admin du serveur MCP, pour le jeton d'un admin seulement" -m "Membres, liens d'invitation et de réinitialisation, rôles, désactivation, types de course et doublons, par les routes et les règles du site. Le jeton d'un membre ne les voit pas : les appeler répond comme un outil inconnu." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 12: Docs

**Files:**
- Modify `README.md`: a section « Assistant IA (MCP) » after « Démo », and one line in « Développement local » (the proxy of `/mcp`).
- Modify `Caddyfile.example`: one comment line, « /mcp et /api/app/mcp-uploads (le serveur MCP) passent par reverse_proxy comme le reste : rien à ajouter. ».
- Update and stage `docs/superpowers/specs/2026-11-03-courses-mcp-design.md` (the spec, with what changed during Tasks 1–11) and `docs/superpowers/plans/2026-11-03-courses-mcp.md` (this plan): both are already in the worktree, untracked.

**Content of the README section** (French, in the README's voice):

- What it is (one paragraph: an assistant does, in your name, what the site lets you do; it asks your agreement before deleting or erasing anything; it never sees a password or an email; the address `https://<domaine>/mcp`).
- **Ce que l'assistant voit**: the thirty-two member tools by area (lire, courses, participations et résultats, commentaires, covoiturage et logement, fichiers, profil et réglages), each limited to what the site lets that person do; the eleven `admin_…` tools only with an admin's token. An account is still created by an invitation that the person opens. What has no tool (spec § 10) and why.
- **Les confirmations**: what asks for one, the 10 minutes, that the assistant must ask you first.
- **Les fichiers**: `start_upload` and the `curl` command, or base64 up to 512 KB; the sizes and types (photo 5 Mo JPEG/PNG/WebP, trace 10 Mo GPX).
- **Créer un jeton**: Profil → Réglages → « Assistant IA (MCP) » → « Nouveau jeton »; it is shown once; five at most; no expiry; 300 requests a minute; « Révoquer » cuts it at once; disabling an account deletes its tokens; never put a token in a repository or a shared file.
- **Claude Code**: the command of the dialog (`claude mcp add --transport http --scope user prends-ton-dossard https://…/mcp --header "Authorization: Bearer ptd_…"`), then `claude mcp list` (the server says it is connected), and `claude mcp remove prends-ton-dossard -s user` to take it off. Why `--scope user`.
- **Claude Desktop**: its remote connectors ask for OAuth, which the site does not offer; it goes through the `mcp-remote` bridge (Node 18+), in `claude_desktop_config.json` (where the file is on macOS and Windows), with the token in `env` and the header as `"Authorization:${PTD_AUTH}"` (no space after the colon: the bridge's own advice for Windows). **Before writing it, check the current syntax and the latest version of `mcp-remote` (`npm view mcp-remote version`, its README) and pin that version in the example.** Restart Claude Desktop. Without a terminal, files go in base64.
- **Autres clients**: streamable HTTP, the address, the `Authorization: Bearer` header; the server keeps no session and answers in JSON.
- **En local**: `http://localhost:5173/mcp` (through Vite) or `http://127.0.0.1:8090/mcp`, with a token made on the local site; never the same token as production.
- **Démo**: no MCP on a demo instance (`DEMO_LOGIN_EMAIL`).
- **Traces**: « Utilisé le … » in Réglages; the request log of the dashboard (by the SSH tunnel) shows each call with the token id, the tools, and whether a confirmation was asked or used.

**Steps:**

- [ ] **Step 1:** write the section and the comment; bring the spec (already in `docs/superpowers/`) up to date with the implementation (any decision taken on the way, the exact messages).
- [ ] **Step 2: check** the Markdown renders (headings, code blocks) and that every command and number in it is the one the code has: the command string equals `claudeCommand` of Task 2 for a sample URL; the route names, the 5 tokens, the 300 requests, the 10 minutes, the 512 KB, the 5 and 10 MB, the tool counts (32 and 11).

  ```bash
  grep -n "claude mcp add" README.md web/src/features/mcp/command.ts
  ```

  Expected: the same option order in both.
- [ ] **Step 3: commit.**

  ```bash
  git add README.md
  git add Caddyfile.example
  git add docs/superpowers/specs/2026-11-03-courses-mcp-design.md
  git add docs/superpowers/plans/2026-11-03-courses-mcp.md
  git commit -m "docs: brancher un assistant IA sur le site (MCP)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 13: End to end with a real MCP client, on a local server (port 8090)

**Files:**
- Create `tools/mcpcheck/main.go`, `tools/mcpcheck/main_test.go`, and `tools/mcpcheck/testdata/` (a small GPX and a small PNG, made by the test helpers' generators and committed).
- Modify `README.md` (« En local » of the MCP section: how to run `mcpcheck`).
- Create `docs/superpowers/decisions/2026-11-03-decisions-mcp.md` (the decisions taken on the way, in the style of `2026-11-02-decisions-v5.md`, starting from spec § 11.2).

**Interfaces:**

`go run ./tools/mcpcheck [-url URL] [-login EMAIL] [-write]` — a client of the official SDK (`mcpsdk.NewClient`, `mcpsdk.StreamableClientTransport` with an `http.Client` whose transport adds the header):

- `-url`: default `http://127.0.0.1:8090/mcp`. The server it names must have been started with `APP_URL` set to its own origin (Step 2): `start_upload` builds its upload address from `APP_URL`, and `mcpcheck` PUTs to that address as it is.
- `-login EMAIL`: **only for a local URL** (`localhost`, `127.0.0.1`): signs in with the password of `PTD_PASSWORD` (default `courses-dev-password`, the seed's), creates a token named `mcpcheck` through `POST /api/app/mcp-tokens`, runs, and revokes it at the end, also on failure (`defer`). Without `-login`, the token comes from `PTD_MCP_TOKEN`.
- Without `-write`: `initialize`, `tools/list` (checked against the role that `whoami` gives: thirty-two tools and no `admin_…` for a member, forty-three for an admin), `whoami`, `home`, `list_race_types`, `search_events`, `get_stats` (read only: usable against production by the user).
- `-write` (**refused for a non-local URL**), as a **member**:
  - `admin_merge` is an unknown tool (`-32602`);
  - `create_event` « Course de test MCP » 30 days ahead (Paris), two formats (the first undated, the second dated a day later), `join` on the second (`format_index: 1`, `registered`); the same again → `done: false` (duplicate), not confirmed, nothing created;
  - `update_event` (rename) → done at once;
  - `add_participation` Bob (`interested`) on the undated format → done, not confirmed;
  - `remove_participation` Bob → a confirmation; the call with a wrong `confirmation` → refused; with the right one → done; the same token again → refused;
  - `add_comment`, then `delete_comment` → a confirmation, then done;
  - `add_offer` (a ride, 3 seats); `offer_place` `take` for Bob → done (the owner places whom she wants); `offer_place` `free` for Bob → a confirmation, then done; `delete_offer` → a confirmation, then done;
  - `start_upload` `track`, `PUT` of `testdata/track.gpx` with the given header, `set_track` with `use_track_values` → done, the distance set; `set_photo` from `testdata/photo.png` in base64 → done (or a confirmation if the seed gave a photo);
  - `update_format` moves the dated format a day later → a confirmation (Alice is on it), then done, the end follows;
  - `delete_format` of the undated format → a confirmation, then done;
  - `calendar_link` `show`; `passkeys` `list`; `mcp_tokens` `list` (the current one marked);
  - `delete_event` → a confirmation, then done;
  - revoke the token, and the next call gets a 401.
- `-write` as an **admin**, after the member steps: `admin_create_runner` « Test MCP »; `admin_create_link` (`invite`) → a URL **that is never printed** (the line says « lien reçu, expire le … »); `admin_revoke_link` → a confirmation, then done; `admin_create_race_type` « Test MCP » then `admin_delete_race_type` → a confirmation, then done; two races « Doublon MCP » created, `admin_merge` → a confirmation with the preview, then merged; `admin_delete_runner` « Test MCP » → a confirmation, then done.
- One line per step: `ok   <step> — <what it saw>` or `FAIL <step> — <why>`; exit 1 on the first failure. **Never prints a token of any kind, an upload secret, an invitation URL or a calendar URL** (not in an error either).
- `main_test.go`: the local-URL guard (`-write` and `-login` refused for `https://prends-ton-dossard.ketra.fr/mcp`), the parsing of the flags, and that no output line of a fake run holds the MCP token, a `cfm_` or `ptu_` token, `invitation#` or `.ics`.

**Steps:**

- [ ] **Step 1: write the failing tests** (`main_test.go`), run `go test ./tools/mcpcheck/` → `FAIL`; implement; → `ok  	courses/tools/mcpcheck`.
- [ ] **Step 2: start a seeded local server on 8090** (ports free first, Global Constraints):

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/health   # 000
  D="$(mktemp -d)"; go run ./server seed --dir "$D"
  APP_URL=http://127.0.0.1:8090 go run ./server serve --http=127.0.0.1:8090 --dir "$D"   # in the background
  curl -s http://127.0.0.1:8090/api/health                                    # {"message":"API is healthy."…}
  ```

  `APP_URL` is the address of this server itself: without it the program says `http://localhost:5173` (the Vite address), where nothing listens in Steps 2 to 4, and the `upload_url` that `start_upload` gives, which `mcpcheck` PUTs to, would point at it (as would `whoami.site`).

- [ ] **Step 3: run the real client, as a member, then as an admin.**

  ```bash
  go run ./tools/mcpcheck -url http://127.0.0.1:8090/mcp -login alice@example.test -write
  go run ./tools/mcpcheck -url http://127.0.0.1:8090/mcp -login admin@example.test -write
  ```

  Expected, for Alice: only `ok` lines, among which `ok   initialize — prends-ton-dossard`, `ok   tools/list — 32 outils (membre)`, `ok   whoami — Alice`, `ok   admin_merge — outil inconnu pour un membre`, `ok   create_event — « Course de test MCP »`, `ok   create_event — doublon : confirmation demandée, rien créé`, `ok   remove_participation — confirmation demandée`, `ok   remove_participation — mauvaise confirmation refusée`, `ok   remove_participation — confirmé, Bob retiré`, `ok   remove_participation — confirmation déjà servie, refusée`, `ok   set_track — envoi en deux temps, <n> points`, `ok   delete_event — confirmé`, `ok   jeton révoqué — 401`; for the admin: `ok   tools/list — 43 outils (admin)`, `ok   admin_create_link — lien reçu, expire le <day>`, `ok   admin_merge — aperçu, puis fusion`, `ok   admin_delete_runner — confirmé`, `ok   jeton révoqué — 401`; exit status 0 both times. (Each run finds the other's races: they use their own names, and confirm the duplicate when they must.)
- [ ] **Step 4: check what a client that is not the Go SDK meets.** Claude Code's SDK speaks protocol 2025-06-18; check that version and the HTTP edges with `curl` (a token made for the occasion through the routes, kept in a shell variable, never echoed, revoked at the end):

  ```bash
  B=http://127.0.0.1:8090
  SESSION=$(curl -s -X POST $B/api/collections/users/auth-with-password -H 'Content-Type: application/json' \
    -d '{"identity":"bob@example.test","password":"courses-dev-password"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))')
  CREATED=$(curl -s -X POST $B/api/app/mcp-tokens -H "Authorization: $SESSION" -H 'Content-Type: application/json' -d '{"name":"curl"}')
  TOKEN=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).token)' "$CREATED")
  ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$CREATED")
  H=(-H "Authorization: Bearer $TOKEN" -H 'Accept: application/json, text/event-stream' -H 'Content-Type: application/json')
  curl -s "${H[@]}" $B/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
  curl -s "${H[@]}" -H 'MCP-Protocol-Version: 2025-06-18' $B/mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
  curl -s "${H[@]}" -H 'MCP-Protocol-Version: 2025-06-18' $B/mcp -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"admin_merge","arguments":{"kind":"events","keep_id":"aaaaaaaaaaaaaaa","merge_id":"bbbbbbbbbbbbbbb"}}}'
  curl -s "${H[@]}" -H 'MCP-Protocol-Version: 2025-06-18' $B/mcp -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"no_such_tool","arguments":{}}}'
  curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" $B/mcp                                   # GET: 405
  curl -s -i -X POST $B/mcp -H 'Content-Type: application/json' -d '{}' | head -5               # 401, WWW-Authenticate: Bearer realm="prends-ton-dossard"
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $B/.well-known/oauth-protected-resource   # 404 application/json
  curl -s -o /dev/null -w '%{http_code}\n' -X PUT $B/api/app/mcp-uploads/aaaaaaaaaaaaaaa --data-binary 'x'   # 400 (no secret)
  curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $B/api/app/mcp-tokens/$ID -H "Authorization: $SESSION"   # 204
  unset SESSION CREATED TOKEN ID H
  ```

  Expected: the `initialize` answer has `"protocolVersion":"2025-06-18"`; `whoami` answers Bob; `admin_merge` (Bob is a member) and `no_such_tool` get the same JSON-RPC error `-32602`, `unknown tool "…"`, but for the name; then 405, 401 with the header, `404 application/json`, 400, 204.
- [ ] **Step 5 (only if Vite is free to start): the proxy.** `pnpm --dir web dev` in the background, then `go run ./tools/mcpcheck -url http://localhost:5173/mcp -login alice@example.test` → `ok` lines (read only). Stop Vite.
- [ ] **Step 6: stop the server, delete `$D`.**
- [ ] **Step 7: full checks** on the whole branch, plus `pnpm --dir web build` and `go build ./server` (the binary embeds the front): all green.
- [ ] **Step 8: write the decisions** (`docs/superpowers/decisions/2026-11-03-decisions-mcp.md`): spec § 11.2 as the starting list, plus what was decided during the tasks, and « À faire par toi »: relire les décisions ; créer un jeton sur le site une fois déployé ; `claude mcp add …` puis demander à Claude « quelles courses arrivent ? » ; lui faire retirer une participation d'essai pour voir la confirmation ; lui faire mettre une trace GPX ; essayer Claude Desktop avec `mcp-remote` ; révoquer les jetons d'essai.
- [ ] **Step 9: commit.**

  ```bash
  git add tools/mcpcheck/main.go
  git add tools/mcpcheck/main_test.go
  git add tools/mcpcheck/testdata/track.gpx
  git add tools/mcpcheck/testdata/photo.png
  git add README.md
  git add docs/superpowers/decisions/2026-11-03-decisions-mcp.md
  git commit -m "test: un vrai client MCP contre le serveur local" -m "tools/mcpcheck, avec le client du SDK officiel : lecture seule par défaut, écriture seulement sur un serveur local, en membre puis en admin, confirmations et envois de fichiers compris." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

- [ ] **Step 10: final review** of `feat/v1..feat/mcp` (superpowers:requesting-code-review), with the Review Focus above; one fix wave if needed, each fix with its test; then report to the user: what was built, the decisions to validate, that nothing is merged into `feat/v1`, pushed or deployed, and the deploy steps (Global Constraints) for when they say so.
