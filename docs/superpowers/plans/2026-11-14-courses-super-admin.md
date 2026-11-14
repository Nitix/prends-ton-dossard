# Super admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an account marked `super_admin` (set only by a server command) that no other admin can change: role, disabled flag, reset link, passkeys, runner name and photo.

**Architecture:** a bool field on `users`, never writable through the API. The collection rules exclude a super admin's account, runner and passkeys from the admins' branch; a model hook keeps a super admin an active admin whatever writes it; the invitation service refuses reset links made by someone else. The MCP announces these refusals before calling, and the members page hides the buttons.

**Tech Stack:** Go + PocketBase v0.41 (`server/`), React 19 + Vitest browser (`web/`).

**Spec:** `docs/superpowers/specs/2026-11-14-courses-super-admin-design.md`

**Execution:** native (the design says so, and the person approved it): one implementer (this session), TDD, then one `opus` security review of the whole branch, one wave of fixes.

## Global Constraints

- CLAUDE.md applies: signed commits, files added one by one, French commit subjects that say what the person gains, attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never touch or stage `docs/superpowers/specs/2026-10-31-courses-design.md`.
- No new dependency. `go.mod`, `go.sum`, `web/package.json`, `pnpm-lock.yaml` unchanged.
- Node through `fnm exec --using=.nvmrc pnpm …`; one browser Vitest run at a time (port 63315).
- Error code `super_admin_protected`, status 403. fr: « Ce compte est super admin : personne d'autre ne peut le modifier. » en: « This account is a super admin: nobody else can change it. »
- Members page: state line « Actif · Super admin » / « Active · Super admin »; hint « Compte protégé : personne d'autre ne peut le modifier. » / « Protected account: nobody else can change it. »
- Command output: `<name> is now a super admin.` / `<name> is no longer a super admin.` — never an email.
- No email, link or token in any output, log or error.
- `web/src/features/admin/memberState.ts` is ported to Go with a SHA-256 in `server/mcp/ports_test.go`: leave it unchanged (the super admin logic goes in `MemberRow.tsx`).

## Review Focus

1. An admin PATCHes `{"super_admin":true}` on their own account, or `{"super_admin":false}` on the super admin's → 404, nothing changes (Task 1 rows).
2. A runner **without** account: the new runner rule (`user.super_admin != true`) must still let an admin rename it and set its photo; a null relation must not make the rule false (Task 1 row "admin renames sam").
3. A reset link made by an admin **before** the mark was set → invalid at lookup and at accept (Task 2 test).
4. The super admin still edits their own runner, skin, reminders and passkeys; a plain member still renames their own runner (Task 1 rows).
5. A Go write that demotes or disables a super admin → `super_admin_protected`; removing the mark first then demoting → allowed (Task 1 hook test).
6. The MCP refusal for a super admin never reads or prints the email (Task 4: the request asks `fields=id,super_admin` only).

---

### Task 1: The field, the rules, the hook and the error code

**Files:**
- Create: `server/migrations/9s_super_admin.go`
- Modify: `server/accounts/hooks.go` (hook on `users` update)
- Modify: `server/apperr/codes.go`, `server/apperr/apperr_test.go` (front-end contract list)
- Modify: `web/src/i18n/errors.ts`, `web/src/i18n/fr.ts`, `web/src/i18n/en.ts` (`errors.super_admin_protected`)
- Modify: `server/mcp/messages.go` (`"super_admin_protected"`, word for word the fr text)
- Test: `server/migrations/rules_test.go` (or a new `server/migrations/super_admin_test.go`), `server/accounts/accounts_test.go`

**Interfaces:**
- Produces: field `users.super_admin` (bool); `apperr.CodeSuperAdminProtected = "super_admin_protected"`; `accounts.IsSuperAdmin(account *core.Record) bool`.
- Rules (built from the previous ones, as 9m does):
  - `userSuperAdminUpdateRule`: both branches get `@request.body.super_admin:isset = false`; the admin branch gets `super_admin != true`.
  - runners update: `@request.body.user:isset = false && ((ruleAdmin && user.super_admin != true) || (ruleSignedIn && user = @request.auth.id))`.
  - passkeys delete: `ruleSignedIn && (user = @request.auth.id || (ruleAdmin && user.super_admin != true))`.
  - `down` removes the field and puts back the rules of 9m / 4.

- [ ] **Step 1: Write the failing rule rows.** In each row, `Before` marks `fx.Admin` super admin and makes `fx.Bob` admin (helper `superAdminSetup`, via `setFields`). Rows:
  - "admin cannot make themselves super admin": As bob, PATCH bob `{"super_admin":true}` → 404, bob's `super_admin` false.
  - "super admin cannot unmark themselves": As admin, PATCH admin `{"super_admin":false}` → 404, still true.
  - "admin cannot demote the super admin": As bob, PATCH admin `{"role":"member"}` → 404, role admin.
  - "admin cannot disable the super admin": As bob, PATCH admin `{"disabled":true}` → 404.
  - "admin cannot rename the runner of the super admin": As bob, PATCH AdminRunner `{"name":"X"}` → 404, name unchanged.
  - "admin cannot set the photo of the super admin": As bob, PATCH AdminRunner multipart avatar (`testutil.ImageForm`) → 404.
  - "admin cannot delete a passkey of the super admin": As bob, DELETE a passkey of Admin (created in `Before`) → 404, still exists.
  - "super admin renames their own runner" → 200; "super admin sets their skin" → 200; "super admin deletes their own passkey" → 204.
  - "admin still renames sam" (no account) → 200; "admin still renames alice" → 200; "admin still changes the role of alice" → 200; "admin still deletes a passkey of alice" → 204; "alice renames herself" → 200.
- [ ] **Step 2: Hook test** in `accounts_test.go`: `TestSuperAdmin_StaysActiveAdmin` — mark Admin super admin, make Bob admin; `app.Save` of Admin with role member → error whose code is `super_admin_protected`; same for `disabled=true`; setting `super_admin=false` then role member → nil. Marking a member super admin with role member → error.
- [ ] **Step 3: Run** `go test ./server/migrations/ ./server/accounts/ -count=1` → FAIL (unknown field / rules not there).
- [ ] **Step 4: Implement** the migration, `IsSuperAdmin`, the hook check in the `users` update hook (`if IsSuperAdmin(e.Record) && !IsActiveAdmin(e.Record) → apperr.New(403, CodeSuperAdminProtected)`), and the error code in the six places.
- [ ] **Step 5: Run** the same tests plus `go test ./server/apperr/ ./server/mcp/ -run 'Codes|Messages' -count=1` → PASS. If the null relation row (Review Focus 2) fails, switch to a null-safe form (`user = "" || user.super_admin != true`) and say so in the commit.
- [ ] **Step 6: Commit** `feat: un compte super admin que les autres admins ne peuvent pas modifier`.

### Task 2: Reset links

**Files:** Modify `server/invitations/service.go`; Test `server/invitations/invitations_test.go`.

**Interfaces:** Consumes `accounts.IsSuperAdmin`. `Create` and `Find` keep their signatures.

- [ ] **Step 1: Tests:** `TestCreate_ResetOfSuperAdmin_RefusedForAnotherAdmin` (CreatedBy = Bob, admin; runner = AdminRunner marked) → apperr 403 `super_admin_protected`, no invitation written; `TestCreate_ResetOfSuperAdmin_ByThemself` → ok; `TestFind_ResetOfSuperAdmin_MadeByAnother_Invalid` (reset created by Bob before the mark, then mark) → `invitation_invalid` for `Find` and for `Accept`, password unchanged; reset of an ordinary account by an admin → unchanged.
- [ ] **Step 2: Run** `go test ./server/invitations/ -count=1` → FAIL.
- [ ] **Step 3: Implement:** in `Create`, for `KindReset`, load the account; if `IsSuperAdmin` and `in.CreatedBy != account.Id` → 403. In `Find`, for `KindReset`, if the account is super admin and `created_by` is not that account → invalid.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: personne d'autre ne peut réinitialiser le compte d'un super admin`.

### Task 3: The command

**Files:** Create `server/cmd/superadmin.go`; Modify `server/main.go` (`AddCommand`); Test `server/cmd/cmd_test.go`.

**Interfaces:** `NewSuperAdminCommand(app core.App) *cobra.Command` (`super-admin <name> [--remove]`); `SetSuperAdmin(app core.App, name string, on bool) (runnerName string, err error)`. Runner found as `findOrCreateRunner` compares (NOCASE) but never created.

- [ ] **Step 1: Tests:** mark → account admin, active, super admin; `--remove` → mark false, role and disabled unchanged; unknown runner → error, nothing written; runner without account → error; a demoted and disabled account → back to admin, active, marked; the command's stdout is exactly `Admin is now a super admin.\n` and contains no `@`.
- [ ] **Step 2: Run** `go test ./server/cmd/ -count=1` → FAIL. **Step 3: Implement** (one transaction; runs the migrations first, as bootstrap-admin). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: la commande super-admin pose ou retire la marque`.

### Task 4: The MCP

**Files:** Modify `server/mcp/admin_members.go`, `server/mcp/admin_links.go`, `server/mcp/tools_settings.go`, `server/mcp/tools_files.go`; Tests next to them (`package mcp_test`).

**Interfaces:**
- `accountRecord.SuperAdmin bool \`json:"super_admin"\``; `accountFields` and `memberFields` ask `super_admin` (`expand.user.super_admin`).
- `(t *tools) superAdminRefusal(ctx context.Context, c *caller, accountID string) error`: nil unless the caller is an admin, `accountID` is not empty and not the caller's, and `GET /api/collections/users/records/<id>?fields=id,super_admin` says true; then `errors.New(messages["super_admin_protected"] + " (super_admin_protected)")`.
- Own account: `admin_set_role` / `admin_set_disabled` on the caller's own super admin account refuse with « Ton compte est super admin : son rôle et son état ne changent que sur le serveur (commande super-admin). »

- [ ] **Step 1: Tests** (caller Bob admin, Admin marked): `admin_set_role`, `admin_set_disabled`, `admin_create_link` kind reset, `rename_runner`, `set_photo`, `passkeys` delete on Admin → tool error with the fr text, and no write reached the site (record unchanged); the same tools on Alice → unchanged behaviour; `admin_list_members` marks Admin « super admin » and no answer contains `@example.test`.
- [ ] **Step 2: Run** `go test ./server/mcp/ -count=1` → FAIL. **Step 3: Implement**, and add one sentence to each tool's description: « Le compte d'un super admin (et son coureur) ne se modifie que par lui-même (super_admin_protected). » **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: l'assistant annonce qu'un super admin ne se modifie pas`.

### Task 5: The members page

**Files:** Modify `web/src/lib/types.ts` (`super_admin?: boolean` on `UserRecord`), `web/src/features/admin/MemberRow.tsx`, `web/src/i18n/fr.ts`, `web/src/i18n/en.ts` (`admin.superAdmin`, `admin.protectedHint`); Test `web/src/features/admin/MembersPage.test.tsx`.

**Interfaces:** `MemberRow` reads the signed-in account with `useSession()`.

- [ ] **Step 1: Tests:** signed in as another admin, the super admin's row reads « Actif · Super admin », shows « Compte protégé : personne d'autre ne peut le modifier. », and has no button (`getByRole("button")` inside the row: none); signed in as the super admin, their own row has « Renommer », « Photo », « Lien de réinitialisation », « Passkeys » but neither « Retirer admin » nor « Désactiver »; an ordinary admin row is unchanged; the same in English for the state line.
- [ ] **Step 2: Run** `fnm exec --using=.nvmrc pnpm --dir web test -- MembersPage` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: la page Membres montre le super admin et cache ce qui ne marcherait pas`.

### Task 6: Docs, full checks, review

**Files:** `README.md` (the command, how to run it in the container, no secret), `docs/TODO.md`, `docs/superpowers/decisions/2026-11-14-decisions-super-admin.md` (the choices made in the person's place, « À faire de ton côté »).

- [ ] **Step 1:** write the docs; commit `docs(super-admin): …`.
- [ ] **Step 2:** the full checks of CLAUDE.md § 3; all green, `git diff main -- go.mod go.sum web/package.json pnpm-lock.yaml` empty.
- [ ] **Step 3:** `opus` security review of `main..HEAD` against this Review Focus; one wave of fixes; limited re-review.
