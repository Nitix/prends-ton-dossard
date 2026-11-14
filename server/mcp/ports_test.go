package mcp_test

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// The ports of the site's TypeScript (each Go port says which function it ports,
// and its tests are the cases of the TS tests, copied when it was ported). Nothing
// else ties them: a later change to the TS would leave the assistant saying or
// doing what the site no longer does. This test holds the SHA-256 of each ported
// file (its line ends made \n): when one changes, it fails, and names the Go to
// port again; once that is done, the new sum goes in its row.
//
// Only the files that hold the ported logic are here. The site's api.ts files
// (eventsFilter of features/events/api.ts, isEdited of features/comments/api.ts)
// hold the site's queries too, and would trip at every change of them: their
// ports keep only the cases of their tests.
var ports = []struct {
	file   string // under web/src
	goPort string
	sum    string
}{
	{"features/events/saveEvent.ts", "planBatch (buildBatch) of plan.go, withXmlDeclaration of gpx.go", "27bfffde26ba20cf63afd507b975b2ccf99c29f940f9d959e1aab87795af930b"},
	{"features/events/formDraft.ts", "eventEndDate and shortens of plan.go and race_writes.go", "5807fdc92759206a6961682425c494391a290691c18ef0811651a8191dfa0ca4"},
	{"lib/dates.ts", "lastRaceDay of views.go, participationRow.lastDay of home.go", "674bc31333e6cac072e999937f5bcde51a0593c7abbf65db609999654143027e"},
	{"features/home/MyUpcoming.tsx", "upcomingOf of home.go", "a141677cfd243d478a63a3d51a0c4269bcf760f73017d600532e1a0aba40620f"},
	{"features/events/duplicates.ts", "duplicates.go", "b34613d9a40541a03f85631164a31aade82ef46b591b760e72265e49a9c333bf"},
	{"features/events/registration.ts", "registrationState (registrationStateOf) of home.go", "a1d8b8c7961118feb6823007bf64b3af229529d4287fd17ba1f916e37b9d3001"},
	{"features/events/participants.ts", "hasStarters of home.go", "e7694134868064d0d35baf7a500ee506c3b8076d41b7ec100f4bd5f1fa3539d9"},
	{"features/home/pending.ts", "pendingOf of home.go", "39aefdaf708e6ba4152bcbd86005df0f6fe5dc6df225ece3545b84169b1ce0a6"},
	{"features/home/registrationTodo.ts", "registrationTodo, todosOf of home.go", "2a5bdf076b911f7984693b065119a7f7bfe29406340f0b7e783a5fb85bd43f01"},
	{"features/results/resultsToEnter.ts", "resultsToEnter of home.go", "b916672a8c6f5e1c5e216ed1e6ba167c295fc86bf04e362732187232897ae734"},
	{"features/results/resultText.ts", "ResultParts of server/wording, hasResult of views.go", "ddb1ac5bfe9a8827d35fb7f8d31fb2805e094b9794e21740e7363c44dbae981a"},
	{"features/stats/stats.ts", "stats.go", "5065bc790b58d26603a19d7f96c5ddfb329b3b5743e1573db34a95d0db20c1bc"},
	{"features/route/gpx.ts", "parseGpx and statsOf of gpx.go", "488f3c213c7efbdca76360a6acb2da11d4308bfb216cf9ae0743feb176792a89"},
	{"features/admin/memberState.ts", "memberState of admin_members.go", "2cbc2de092245dcd95e616adedc212ca6aaef639f23665eb1eab4a9155137e04"},
	{"features/admin/mergePreview.ts", "describeMerge of admin_merge.go", "3716dca43798de3c56457dce18baf9cbf89fdc9e05be1797f0d402c4ae1e3961"},
	{"features/comments/excerpt.ts", "excerpt of home.go", "904f45e3d9a966a68f28276dc3771b8db216171d79b0f317398b9da9fc1a4748"},
	{"features/events/opening.ts", "openings.go of server/events", "a02b09d01f4420a1150b1a83333a01833a557672f9e0a5b8738e8a5ac8751603"},
}

func TestPorts_TheTypeScriptHasNotChanged(t *testing.T) {
	for _, port := range ports {
		source := repoFile(t, append([]string{"web", "src"}, strings.Split(port.file, "/")...)...)
		sum := sha256.Sum256([]byte(strings.ReplaceAll(source, "\r\n", "\n")))
		if got := hex.EncodeToString(sum[:]); got != port.sum {
			t.Errorf("web/src/%s changed: port it again (Go: %s), with the cases of its tests, then put its new sum %s in its row",
				port.file, port.goPort, got)
		}
	}
}
