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
	{"features/events/saveEvent.ts", "planBatch (buildBatch) of plan.go, withXmlDeclaration of gpx.go", "26b92d83de1e5702e0d34f4973293636474b5fa5492fc927ee352aecf3570683"},
	{"features/events/formDraft.ts", "eventEndDate and shortens of plan.go and race_writes.go", "0ac4bc816bc00becfddda3bcb440c20c274d706262d902348f7e6c8139fb8855"},
	{"features/events/duplicates.ts", "duplicates.go", "b34613d9a40541a03f85631164a31aade82ef46b591b760e72265e49a9c333bf"},
	{"features/events/registration.ts", "registrationState of home.go", "1c6a296f39a5099e95a6bf820b19896130cf0b0901ae68474821dc2d11b06cfe"},
	{"features/events/participants.ts", "hasStarters of home.go", "e7694134868064d0d35baf7a500ee506c3b8076d41b7ec100f4bd5f1fa3539d9"},
	{"features/home/pending.ts", "pendingOf of home.go", "33518a8e9dc33cb685904bfaa59e2b55ce9337dbfcbfe3eb0fa77d539945cbb5"},
	{"features/home/registrationTodo.ts", "registrationTodo of home.go", "580e9f9aa94018935b30eb6bdd3872a927e4377e432a9df357172745fbc10ae0"},
	{"features/results/resultsToEnter.ts", "resultsToEnter of home.go", "c5a849992eb676e95492f5458dd72a554cdb16ed5c2f336e558009caafc4ec29"},
	{"features/results/resultText.ts", "ResultParts of server/wording, hasResult of views.go", "ddb1ac5bfe9a8827d35fb7f8d31fb2805e094b9794e21740e7363c44dbae981a"},
	{"features/stats/stats.ts", "stats.go", "5065bc790b58d26603a19d7f96c5ddfb329b3b5743e1573db34a95d0db20c1bc"},
	{"features/route/gpx.ts", "parseGpx and statsOf of gpx.go", "488f3c213c7efbdca76360a6acb2da11d4308bfb216cf9ae0743feb176792a89"},
	{"features/admin/memberState.ts", "memberState of admin_members.go", "2cbc2de092245dcd95e616adedc212ca6aaef639f23665eb1eab4a9155137e04"},
	{"features/admin/mergePreview.ts", "describeMerge of admin_merge.go", "ac223910c6e9c3c6dc56ca333ffe6c34f13113d5bdb7f8dff832d7f26538adc9"},
	{"features/comments/excerpt.ts", "excerpt of home.go", "904f45e3d9a966a68f28276dc3771b8db216171d79b0f317398b9da9fc1a4748"},
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
