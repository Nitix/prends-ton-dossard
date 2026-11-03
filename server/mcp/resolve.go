package mcp

import (
	"cmp"
	"errors"
	"fmt"
	"slices"
	"strings"

	"courses/server/wording"
)

// The names that an error lists, at most: the group is a few dozen people, and a
// message that lists them all is no help (spec § 6.1: about fifteen).
const maxListedNames = 15

// compareNames orders names the way a person reads a list: without regard to the
// case or the accents (localeCompare of the site), then as they are written.
func compareNames(a, b string) int {
	return cmp.Or(cmp.Compare(wording.Fold(a), wording.Fold(b)), cmp.Compare(a, b))
}

// find is what a runner or a race type is asked for by (spec § 6.1): its id, or
// its name, without regard to the case or the accents. A name that is only a part
// of one is not one.
func find[T any](all []T, input string, id, name func(T) string) []T {
	for _, record := range all {
		if id(record) == input {
			return []T{record}
		}
	}
	wanted := wording.Fold(input)
	if wanted == "" {
		return nil
	}
	var found []T
	for _, record := range all {
		if wording.Fold(name(record)) == wanted {
			found = append(found, record)
		}
	}
	return found
}

// listNames lists names for an error, in order, with how many are left out and
// the tool that gives them all.
func listNames(names []string, listTool string) string {
	slices.SortFunc(names, compareNames)
	if len(names) <= maxListedNames {
		return strings.Join(names, ", ")
	}
	return fmt.Sprintf("%s et %d autres (%s les donne tous)", strings.Join(names[:maxListedNames], ", "), len(names)-maxListedNames, listTool)
}

// resolveRunner is the runner that idOrName stands for: an id or a name (Fold,
// exact). No name is the caller's runner, me (their id, "" when they have none).
// An unknown runner is an error that lists the names; two runners of one name
// are not guessed between.
func resolveRunner(all []runnerRecord, idOrName, me string) (runnerRecord, error) {
	input := strings.TrimSpace(idOrName)
	if input == "" {
		for _, r := range all {
			if me != "" && r.ID == me {
				return r, nil
			}
		}
		return runnerRecord{}, errors.New(noRunner)
	}

	found := find(all, input, func(r runnerRecord) string { return r.ID }, func(r runnerRecord) string { return r.Name })
	switch len(found) {
	case 1:
		return found[0], nil
	case 0:
		names := make([]string, len(all))
		for i, r := range all {
			names[i] = r.Name
		}
		return runnerRecord{}, fmt.Errorf("Coureur inconnu : « %s ». Les coureurs du groupe : %s.", input, listNames(names, "list_runners"))
	}
	ids := make([]string, len(found))
	for i, r := range found {
		ids[i] = r.ID
	}
	return runnerRecord{}, fmt.Errorf("Plusieurs coureurs s'appellent « %s » : donne l'identifiant de celui que tu veux (%s).", input, strings.Join(ids, ", "))
}

// resolveRaceType is the race type that idOrName stands for: an id or a name
// (Fold, exact). An unknown type is an error that lists the names.
func resolveRaceType(all []raceTypeRecord, idOrName string) (raceTypeRecord, error) {
	input := strings.TrimSpace(idOrName)

	found := find(all, input, func(r raceTypeRecord) string { return r.ID }, func(r raceTypeRecord) string { return r.Label })
	switch len(found) {
	case 1:
		return found[0], nil
	case 0:
		labels := make([]string, len(all))
		for i, r := range all {
			labels[i] = r.Label
		}
		return raceTypeRecord{}, fmt.Errorf("Type de course inconnu : « %s ». Les types de course : %s.", input, listNames(labels, "list_race_types"))
	}
	ids := make([]string, len(found))
	for i, r := range found {
		ids[i] = r.ID
	}
	return raceTypeRecord{}, fmt.Errorf("Plusieurs types de course s'appellent « %s » : donne l'identifiant de celui que tu veux (%s).", input, strings.Join(ids, ", "))
}

// runnerOfAccount is the id of the runner whose account is userID, "" when the
// account has none.
func runnerOfAccount(all []runnerRecord, userID string) string {
	if userID == "" {
		return ""
	}
	for _, r := range all {
		if r.User == userID {
			return r.ID
		}
	}
	return ""
}
