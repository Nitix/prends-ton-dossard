package mcp

import (
	"fmt"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// inputSchema is the schema of the input of a tool: the one that the SDK infers
// from T (jsonschema.For: a field without omitempty is required, the jsonschema
// tag is its description), with the values that some fields may take. enums
// names a field by its JSON name, and a field of the items of an array or of an
// object by its path ("formats.race_type"); the values of a list of texts are
// the ones of its items. The SDK refuses a value out of the list before the
// tool runs.
//
// A field of enums that T does not have is a mistake of the code: it panics,
// when the servers are made.
func inputSchema[T any](enums map[string][]string) *jsonschema.Schema {
	var zero T
	schema, err := jsonschema.For[T](nil)
	if err != nil {
		panic(fmt.Sprintf("mcp: the schema of %T: %v", zero, err))
	}
	for path, values := range enums {
		property := schema
		for name := range strings.SplitSeq(path, ".") {
			if property.Items != nil {
				property = property.Items
			}
			property = property.Properties[name]
			if property == nil {
				panic(fmt.Sprintf("mcp: the schema of %T has no field %s", zero, path))
			}
		}
		// The values of a list are the values of its items.
		if property.Items != nil {
			property = property.Items
		}
		property.Enum = make([]any, len(values))
		for i, value := range values {
			property.Enum[i] = value
		}
	}
	return schema
}
