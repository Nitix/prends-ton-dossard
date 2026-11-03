package mcp

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// What every write tool shares (« The pattern of a write tool »): its answer,
// its schemas and annotations, the confirmation that a call presents, and the
// words its messages are written with. The tools of the races add theirs in
// race_writes.go.

// ---------------------------------------------------------------------------
// The answers

// writeStatus is what every write tool answers (spec § 6.1): done or not, a
// sentence, the warnings, and, when nothing was done, the confirmation to ask
// for.
type writeStatus struct {
	Done         bool             `json:"done" jsonschema:"vrai quand c'est fait ; faux quand rien n'a été fait : summary dit pourquoi, et confirmation ce qu'il faut demander à la personne"`
	Summary      string           `json:"summary" jsonschema:"ce qui a été fait, ou pourquoi rien ne l'a été, en une phrase"`
	Warnings     []string         `json:"warnings,omitempty" jsonschema:"ce qu'il vaut la peine de vérifier, sans que cela ait empêché quoi que ce soit"`
	Confirmation *confirmationOut `json:"confirmation,omitempty" jsonschema:"quand rien n'a été fait faute d'accord : ce qui serait perdu ou changé, et le jeton à redonner si la personne accepte"`
}

// writeSchema is the output schema of a write tool: the one of T, where only
// done and summary are always there (a call that did nothing has no race).
func writeSchema[T any]() *jsonschema.Schema {
	var zero T
	schema, err := jsonschema.For[T](nil)
	if err != nil {
		panic(fmt.Sprintf("mcp: the schema of %T: %v", zero, err))
	}
	schema.Required = []string{"done", "summary"}
	return schema
}

// notDoneOut is the answer of a call that wrote nothing.
func notDoneOut(out *confirmationOut, notice string) writeStatus {
	return writeStatus{Summary: notDone(out, notice), Confirmation: out}
}

// writeAnnotations are the annotations of a tool that writes (spec § 6.1).
func writeAnnotations(destructive, idempotent bool) *mcpsdk.ToolAnnotations {
	return &mcpsdk.ToolAnnotations{DestructiveHint: ptr(destructive), IdempotentHint: idempotent, OpenWorldHint: ptr(false)}
}

// ---------------------------------------------------------------------------
// The inputs

// withMinimum sets the minimum of the numbers at these paths of schema, as
// inputSchema finds a field (a field of the items of a list by its path).
func withMinimum(schema *jsonschema.Schema, minimum float64, paths ...string) *jsonschema.Schema {
	for _, path := range paths {
		property := schema
		for name := range strings.SplitSeq(path, ".") {
			if property.Items != nil {
				property = property.Items
			}
			property = property.Properties[name]
			if property == nil {
				panic("mcp: no field " + path + " in a schema")
			}
		}
		property.Minimum = ptr(minimum)
	}
	return schema
}

// prefixed is each of names after prefix and a dot.
func prefixed(prefix string, names []string) []string {
	out := make([]string, len(names))
	for i, name := range names {
		out[i] = prefix + "." + name
	}
	return out
}

// trimmed is s without the blanks around it; nil stays nil.
func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	return ptr(strings.TrimSpace(*s))
}

// ---------------------------------------------------------------------------
// The words of the messages

// number writes a number as the site does in French: a comma before the
// decimals.
func number(v float64) string {
	return strings.ReplaceAll(strconv.FormatFloat(v, 'f', -1, 64), ".", ",")
}

// quote puts a text that a member wrote between « », which the text cannot
// close: a « or a » in it becomes ‹ or ›. The message of a confirmation is what
// the assistant reads when it decides what to say to the person: nothing that a
// member wrote may read there as the message's own words.
func quote(text string) string {
	return "« " + guillemets.Replace(text) + " »"
}

// plain writes a text that a member wrote, which a message shows outside « »
// (the race of a format, between parentheses): its « and » become ‹ and ›, so
// that it opens or closes no quotation of the message either.
func plain(text string) string {
	return guillemets.Replace(text)
}

// guillemets turns the French quotation marks of a text into single ones.
var guillemets = strings.NewReplacer("«", "‹", "»", "›")

// upperFirst writes the first letter of s in upper case: a phrase that starts a
// sentence.
func upperFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}

// plural is n and the noun that agrees with it (one for 0 and 1, as French
// says it).
func plural(n int, one, many string) string {
	if n > 1 {
		return strconv.Itoa(n) + " " + many
	}
	return strconv.Itoa(n) + " " + one
}

// participantLabel is a participation as a confirmation names it: the runner,
// the status (and the result when there is one), and whether it is confirmed:
// « Bob (Intéressé, non confirmé) ».
func participantLabel(w wording.Words, p participationRecord) string {
	text := resultText(w, p)
	if !p.Confirmed {
		text += ", non confirmé"
	}
	return p.Expand.Runner.Name + " (" + plain(text) + ")"
}

// participantLabels are participations as a confirmation names them.
func participantLabels(w wording.Words, list []participationRecord) string {
	labels := make([]string, len(list))
	for i, p := range list {
		labels[i] = participantLabel(w, p)
	}
	return strings.Join(labels, ", ")
}

// stampsOf are the stamps of participations.
func stampsOf(list []participationRecord) []stamp {
	out := make([]stamp, len(list))
	for i, p := range list {
		out[i] = stamp{Collection: "participations", ID: p.ID, Updated: p.Updated}
	}
	return out
}

// ---------------------------------------------------------------------------
// The confirmation that a call presents

// confirmable is the input of a write tool: it may carry the token of a
// confirmation (spec § 6.13).
type confirmable interface {
	confirmationGiven() string
}

// usesUpConfirmation is the handler of a write tool, which takes the
// confirmation that a call presents whatever happens (spec § 6.13: « toujours
// prise »). guard takes it when the call gets that far; a call that the tool
// refuses before (an id that is not one, a race that is not there, a refusal
// that it announces) takes it here, once the handler is done, even when it
// panics. A token taken twice is the same as taken once: spent.
func usesUpConfirmation[In confirmable, Out any](t *tools, handler mcpsdk.ToolHandlerFor[In, Out]) mcpsdk.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, req *mcpsdk.CallToolRequest, in In) (*mcpsdk.CallToolResult, Out, error) {
		defer t.useUp(in.confirmationGiven())
		return handler(ctx, req, in)
	}
}

// useUp spends a token that a call presented, whatever it was given for.
func (t *tools) useUp(given string) {
	if given = strings.TrimSpace(given); given != "" && t.confirms != nil {
		t.confirms.take(given, pendingConfirmation{})
	}
}
