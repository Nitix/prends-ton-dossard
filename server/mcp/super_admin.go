package mcp

import (
	"context"
	"errors"
)

// The super admin (spec 2026-11-14-courses-super-admin-design): an account that
// no other admin changes, nor its runner. The rules of the site refuse it (a
// 404, as any refusal of a rule); the tools announce it before they call, in
// the words of super_admin_protected, so that the assistant knows why.

// superAdminNote is the sentence that the descriptions of the tools that change
// an account or a runner end with.
const superAdminNote = " Le compte d'un super admin et son coureur ne se modifient que par lui-même : le refus est annoncé (super_admin_protected)."

// errSuperAdminProtected is the refusal for the account or the runner of a super
// admin that is not the caller's: the site's words, and the code.
func errSuperAdminProtected() error {
	return errors.New(messages["super_admin_protected"] + " (super_admin_protected)")
}

// errOwnSuperAdmin is the refusal for the super admin's own role and state: the
// rules keep them out of the API for everybody, its owner included.
var errOwnSuperAdmin = errors.New("Ton compte est super admin : son rôle et son état ne changent que sur le serveur (commande super-admin).")

// superAdminAccountRefusal is the refusal for a change of the role or the state
// of account, which own says is the caller's: nil when it is not a super admin.
func superAdminAccountRefusal(account *accountRecord, own bool) error {
	switch {
	case !account.SuperAdmin:
		return nil
	case own:
		return errOwnSuperAdmin
	}
	return errSuperAdminProtected()
}

// othersSuperAdmin reports whether accountID is the account of a super admin
// that is not the caller's. Only an admin's call is looked at: what a member may
// not change is refused by the site's other rules, which the tools announce
// already. The account is read through the runners and their accounts, as the
// members page reads it: the tools have no read of the accounts themselves.
func (t *tools) othersSuperAdmin(ctx context.Context, c *caller, accountID string) (bool, error) {
	if c.role != roleAdmin || accountID == "" || accountID == c.user.Id {
		return false, nil
	}
	runners, err := t.memberRunners(ctx)
	if err != nil {
		return false, err
	}
	for _, r := range runners {
		if account := r.account(); account != nil && account.ID == accountID {
			return account.SuperAdmin, nil
		}
	}
	return false, nil
}
