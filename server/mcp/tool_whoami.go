package mcp

import (
	"context"
	"errors"
	"net/url"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// paris is the time zone of the days of the site: "today" is the day it is in
// Paris, whatever the zone of the server.
var paris = func() *time.Location {
	location, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		// Not possible with the database of time/tzdata linked in (setup).
		panic("loading the time zone of the site: " + err.Error())
	}
	return location
}()

// today is the day it is in Paris, as the site writes a day.
func today() string {
	return now().In(paris).Format(time.DateOnly)
}

// noRunner is the refusal for an account without a runner, which the
// invitations never make (spec § 6.4).
const noRunner = "Ton compte n'a pas de coureur : demande à un admin."

// whoamiOut is the answer of whoami (spec § 6.4).
type whoamiOut struct {
	Runner whoamiRunner `json:"runner" jsonschema:"le coureur de la personne au nom de qui tu agis"`
	Role   string       `json:"role" jsonschema:"son rôle : member, ou admin (qui a aussi les outils admin_…)"`
	Token  whoamiToken  `json:"token" jsonschema:"le jeton de cet appel"`
	Site   string       `json:"site" jsonschema:"l'adresse du site"`
	Today  string       `json:"today" jsonschema:"le jour d'aujourd'hui à Paris, AAAA-MM-JJ"`
}

type whoamiRunner struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url" jsonschema:"l'adresse de sa page sur le site"`
}

type whoamiToken struct {
	ID   string `json:"id"`
	Name string `json:"name" jsonschema:"le nom que la personne lui a donné dans ses réglages"`
}

func addWhoami(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "whoami",
		Title: "Qui suis-je ?",
		Description: "Dit au nom de qui tu agis (son coureur et son rôle), avec quel jeton, sur quel site, " +
			"et quel jour on est à Paris. Appelle-le en premier.",
		Annotations: &mcpsdk.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: ptr(false)},
	}, t.whoami)
}

// whoami is the runner of the caller, read as the profile does, their role,
// the token of the call, the site and the day.
func (t *tools) whoami(ctx context.Context, _ *mcpsdk.CallToolRequest, _ struct{}) (*mcpsdk.CallToolResult, whoamiOut, error) {
	c, err := callerOf(ctx)
	if err != nil {
		return nil, whoamiOut{}, describe(t.app, err, nil)
	}
	// The id of an account that the database gave: checked all the same, as
	// every value of a filter.
	if !isID(c.user.Id) {
		return nil, whoamiOut{}, describe(t.app, errors.New("mcp: an account id that is not an id"), nil)
	}

	var page struct {
		Items []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"items"`
	}
	query := url.Values{"filter": {"(user='" + c.user.Id + "')"}, "perPage": {"1"}, "skipTotal": {"1"}}
	if err := t.inner.get(ctx, "/api/collections/runners/records?"+query.Encode(), &page); err != nil {
		return nil, whoamiOut{}, describe(t.app, err, nil)
	}
	if len(page.Items) == 0 {
		return nil, whoamiOut{}, errors.New(noRunner)
	}
	runner := page.Items[0]

	return nil, whoamiOut{
		Runner: whoamiRunner{ID: runner.ID, Name: runner.Name, URL: t.cfg.AppURL + "/coureurs/" + runner.ID},
		Role:   c.role.String(),
		Token:  whoamiToken{ID: c.token.Id, Name: c.token.GetString("name")},
		Site:   t.cfg.AppURL,
		Today:  today(),
	}, nil
}
