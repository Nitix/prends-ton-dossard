package migrations

import (
	"database/sql"
	"errors"
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upOffers, downOffers)
}

// ownerClause says who an offer is up to: its owner, and the admins.
const ownerClause = `(owner.user = @request.auth.id || ` + ruleAdmin + `)`

// offerRules are the rules of "offers": every member reads and offers, and the
// owner and the admins change and delete an offer, but never its owner, its
// event or its kind. They come with the hooks of the offers package, which set
// the owner from the caller and pin the three fields on an update.
//
// They are not in accessRules: the rollback of the migration 4 only concerns
// the collections of the migrations 1 to 4.
var offerRules = collectionRules{
	list:   ruleSignedIn,
	view:   ruleSignedIn,
	create: ruleSignedIn,
	update: ruleSignedIn + ` && ` + ownerClause +
		` && @request.body.owner:isset = false && @request.body.event:isset = false && @request.body.kind:isset = false`,
	delete: ruleSignedIn + ` && ` + ownerClause,
}

// placeClause says who a place is up to: the runner who has it (taking and
// freeing it for oneself), the owner of the offer (placing and removing whoever
// they want in it), and the admins.
const placeClause = ruleSignedIn +
	` && (runner.user = @request.auth.id || offer.owner.user = @request.auth.id || ` + ruleAdmin + `)`

// offerMemberRules are the rules of "offer_members": every member reads, a place
// is taken and freed by whom placeClause says, and nobody changes one: to move
// somebody, one frees the place and takes another. The hooks of the offers
// package set who added the place.
var offerMemberRules = collectionRules{
	list:   ruleSignedIn,
	view:   ruleSignedIn,
	create: placeClause,
	delete: placeClause,
}

// upOffers creates the cars and the lodgings of an event, and the places that
// people take in them.
//
//   - An offer goes with its event, and a place with its offer and with its
//     runner: deleting a runner frees the places they had.
//   - The owner of an offer is a runner and is not deleted from under it: no
//     cascade, so that a runner who offers a car or a lodging cannot be deleted.
//   - Who added a place is only a mark: no cascade either, and it is not
//     required.
//   - The number of seats is 0 for "not given" (a lodging without a limit), as
//     for every number of the application. That a car has from 1 to 8 seats is
//     checked by the hooks of the offers package, which report a code.
//   - A runner has a place once in an offer. That they have one of each kind per
//     event is checked by the hooks.
func upOffers(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	runners, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return err
	}

	zero, thirty := 0.0, 30.0
	offers := core.NewBaseCollection("offers")
	offers.Fields.Add(
		cascade(required(relation("event", events))),
		&core.SelectField{Name: "kind", Values: []string{"ride", "lodging"}, MaxSelect: 1, Required: true},
		// Set by the server from the signed-in user.
		required(relation("owner", runners)),
		&core.TextField{Name: "place", Required: true, Max: 120},
		&core.NumberField{Name: "seats", OnlyInt: true, Min: &zero, Max: &thirty},
		// Days are YYYY-MM-DD texts, as in the events, and the time is HH:MM:
		// their form and order are checked by the hooks, which report codes.
		&core.TextField{Name: "date"},
		&core.TextField{Name: "time"},
		&core.TextField{Name: "end_date"},
		&core.URLField{Name: "url"},
		&core.TextField{Name: "notes", Max: 1000},
	)
	// The offers of an event, of one kind.
	offers.Indexes = types.JSONArray[string]{
		"CREATE INDEX idx_offers_event_kind ON offers (event, kind)",
	}
	if _, err := saveCollection(app, withTimestamps(offers)); err != nil {
		return err
	}

	members := core.NewBaseCollection("offer_members")
	members.Fields.Add(
		cascade(required(relation("offer", offers))),
		cascade(required(relation("runner", runners))),
		// Set by the server from the signed-in user.
		relation("added_by", runners),
	)
	members.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_offer_members_offer_runner ON offer_members (offer, runner)",
	}
	if _, err := saveCollection(app, withTimestamps(members)); err != nil {
		return err
	}

	if err := setRules(app, "offers", offerRules); err != nil {
		return err
	}
	return setRules(app, "offer_members", offerMemberRules)
}

// downOffers drops the two tables, and the offers and places in them. The places
// come first: they point at the offers.
func downOffers(app core.App) error {
	for _, name := range []string{"offer_members", "offers"} {
		c, err := app.FindCollectionByNameOrId(name)
		if errors.Is(err, sql.ErrNoRows) {
			continue // already gone
		}
		if err != nil {
			return err
		}
		if err := app.Delete(c); err != nil {
			return fmt.Errorf("%s: %w", c.Name, err)
		}
	}
	return nil
}
