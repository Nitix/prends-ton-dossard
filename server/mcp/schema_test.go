package mcp_test

import (
	"slices"
	"testing"

	"courses/server/mcp"
)

type schemaInput struct {
	Status  string `json:"status" jsonschema:"le statut"`
	Period  string `json:"period,omitempty" jsonschema:"la période"`
	Formats []struct {
		Kind string `json:"kind" jsonschema:"la sorte"`
	} `json:"formats,omitempty" jsonschema:"les épreuves"`
}

// The schema of an input is the one that the SDK infers, with the values that a
// field may take.
func TestInputSchema_Enums(t *testing.T) {
	s := mcp.InputSchema[schemaInput](map[string][]string{
		"status":       {"interested", "registered"},
		"period":       {"upcoming", "past"},
		"formats.kind": {"ride", "lodging"},
	})

	if s.Type != "object" {
		t.Errorf("type %q, want object", s.Type)
	}
	if !slices.Equal(s.Required, []string{"status"}) {
		t.Errorf("required %v, want the fields without omitempty", s.Required)
	}
	if got := s.Properties["status"].Description; got != "le statut" {
		t.Errorf("the description of status is %q", got)
	}
	for path, got := range map[string][]any{
		"status":       s.Properties["status"].Enum,
		"period":       s.Properties["period"].Enum,
		"formats.kind": s.Properties["formats"].Items.Properties["kind"].Enum,
	} {
		if len(got) != 2 {
			t.Errorf("%s: enum %v, want two values", path, got)
		}
	}

	defer func() {
		if recover() == nil {
			t.Error("an enum of a field that does not exist does not panic")
		}
	}()
	mcp.InputSchema[schemaInput](map[string][]string{"statut": {"x"}})
}
