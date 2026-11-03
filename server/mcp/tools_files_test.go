package mcp_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The files (spec § 6.9): start_upload, set_photo and set_track.

// xmlDeclaration is the declaration that testutil.GPX starts with.
const xmlDeclaration = `<?xml version="1.0" encoding="UTF-8"?>`

// b64 is data in base64, as an assistant sends a small file.
func b64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// withFile puts a file in a field of a record, directly in the database, as a
// photo or a track sent earlier from the site.
func withFile(t testing.TB, app core.App, record *core.Record, field, name string, data []byte) string {
	t.Helper()
	file, err := filesystem.NewFileFromBytes(data, name)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := app.FindRecordById(record.Collection().Name, record.Id)
	if err != nil {
		t.Fatal(err)
	}
	stored.Set(field, file)
	if err := app.Save(stored); err != nil {
		t.Fatalf("saving the %s of a %s record: %v", field, stored.Collection().Name, err)
	}
	return stored.GetString(field)
}

// fileURL is the address of a file of a record, as the answers give it.
func fileURL(collection, id, name string) string {
	return siteURL + "/api/files/" + collection + "/" + id + "/" + name
}

// served reads a file of the site, by its path, as a browser does: it must be
// there, with that type; it returns its bytes.
func served(t *testing.T, app *tests.TestApp, path, contentType string) []byte {
	t.Helper()
	var body []byte
	(&tests.ApiScenario{
		Method:         http.MethodGet,
		URL:            path,
		ExpectedStatus: http.StatusOK,
		// A text that no file of the tests holds: the body is read below.
		NotExpectedContent:    []string{"\x00no such text\x00"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, contentType) {
				t.Errorf("%s is served as %q, want %s", path, got, contentType)
			}
			read, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			body = read
		},
	}).Test(t)
	return body
}

// pathOf is the path of an address of the site.
func pathOf(address string) string {
	return strings.TrimPrefix(address, siteURL)
}

// gifImage is a small GIF: a type of image that the site does not take.
func gifImage(t testing.TB) []byte {
	t.Helper()
	img := image.NewPaletted(image.Rect(0, 0, 4, 4), []color.Color{color.Black, color.White})
	var out bytes.Buffer
	if err := gif.Encode(&out, img, nil); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// updatesOf records the media type of each update request of a collection that
// the API receives.
func updatesOf(app *tests.TestApp, collection string) *[]string {
	var types []string
	app.OnRecordUpdateRequest(collection).BindFunc(func(e *core.RecordRequestEvent) error {
		types = append(types, e.Request.Header.Get("Content-Type"))
		return e.Next()
	})
	return &types
}

func TestTools_StartUpload(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	for _, row := range []struct {
		purpose  string
		maxBytes float64
		accepted string
	}{
		{"photo", 5 << 20, "JPEG, PNG ou WebP"},
		{"track", 10 << 20, "GPX"},
	} {
		t.Run(row.purpose, func(t *testing.T) {
			result := succeeded(t, callTool(t, app, alice, "start_upload", map[string]any{"purpose": row.purpose}))
			textIs(t, result)
			s := result.Structured
			id, _ := s["upload_id"].(string)
			secret, _ := s["secret"].(string)
			if !slotID.MatchString(id) || !slotSecret.MatchString(secret) {
				t.Fatalf("the slot %q has the secret %s", id, prefix(secret))
			}
			address := siteURL + "/api/app/mcp-uploads/" + id
			if s["upload_url"] != address {
				t.Errorf("upload_url = %v, want %s", s["upload_url"], address)
			}
			if s["expires_at"] != "2026-05-01T10:10:00Z" {
				t.Errorf("expires_at = %v, want ten minutes from now", s["expires_at"])
			}
			if s["max_bytes"] != row.maxBytes {
				t.Errorf("max_bytes = %v, want %v", s["max_bytes"], row.maxBytes)
			}
			if accepted, _ := s["accepted"].(string); !strings.HasPrefix(accepted, row.accepted) {
				t.Errorf("accepted = %q, want %q", accepted, row.accepted)
			}
			// The command sends the file as it is, with the secret in a header and
			// the type of a file (curl's own is a form's), to the address of the site.
			want := `curl -sS -X PUT -H "X-Upload-Secret: ` + secret + `" -H "Content-Type: application/octet-stream" --data-binary @<fichier> ` + address
			if s["command"] != want {
				t.Errorf("command = %q, want %q", redact(s["command"].(string)), redact(want))
			}
		})
	}

	t.Run("a purpose that is not one: the schema", func(t *testing.T) {
		if result := callTool(t, app, alice, "start_upload", map[string]any{"purpose": "video"}); !result.IsError {
			t.Errorf("a video is answered %.200s", redact(result.Text))
		}
	})

	t.Run("the address of the site, behind its proxy", func(t *testing.T) {
		public := testutil.NewAppWith(t, map[string]string{"APP_URL": "https://dossard.example.test"})
		pfx := testutil.Seed(t, public)
		result := succeeded(t, callTool(t, public, newToken(t, public, pfx.Alice), "start_upload", map[string]any{"purpose": "photo"}))
		address := "https://dossard.example.test/api/app/mcp-uploads/" + result.Structured["upload_id"].(string)
		if result.Structured["upload_url"] != address || !strings.HasSuffix(result.Structured["command"].(string), " "+address) {
			t.Errorf("the slot is at %v, the command %q; want %s", result.Structured["upload_url"], redact(result.Structured["command"].(string)), address)
		}
	})
}

func TestTools_SetPhoto(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)
	png := testutil.PNG(t, 64, 48)
	updates := updatesOf(app, "runners")
	avatar := func(r *core.Record) string {
		t.Helper()
		return storedRecord(t, app, "runners", r.Id).GetString("avatar")
	}

	t.Run("Alice sets her photo from an upload: written at once, she had none", func(t *testing.T) {
		id := uploaded(t, app, alice, "photo", png)
		result := isDone(t, callTool(t, app, alice, "set_photo", map[string]any{"upload_id": id}))
		name := avatar(fx.AliceRunner)
		if !strings.HasSuffix(name, ".png") {
			t.Fatalf("Alice's photo is %q", name)
		}
		address := fileURL("runners", fx.AliceRunner.Id, name)
		assertJSON(t, result.Structured["runner"], map[string]any{"id": fx.AliceRunner.Id, "name": "Alice", "photo_url": address})
		// The file as it was sent, and the thumbs that the site shows.
		if got := served(t, app, pathOf(address), "image/png"); !bytes.Equal(got, png) {
			t.Errorf("the photo is %d bytes, not the %d sent", len(got), len(png))
		}
		for _, thumb := range []string{"96x96", "256x256"} {
			served(t, app, pathOf(address)+"?thumb="+thumb, "image/png")
		}
		if got := (*updates)[len(*updates)-1]; !strings.HasPrefix(got, "multipart/form-data") {
			t.Errorf("the photo was sent as %q", got)
		}
		// The slot is taken: it does not serve twice.
		announced(t, app, alice, "set_photo", map[string]any{"upload_id": id}, "(upload_invalid)")
	})

	t.Run("again: a confirmation (one exists), then replaced", func(t *testing.T) {
		before := avatar(fx.AliceRunner)
		args := map[string]any{"upload_id": uploaded(t, app, alice, "photo", testutil.PNG(t, 32, 32))}
		var token string
		writesNothing(t, app, func() {
			var message string
			var details []string
			token, message, details = asked(t, callTool(t, app, alice, "set_photo", args))
			mentions(t, message, details, "La photo actuelle d'Alice serait remplacée", fileURL("runners", fx.AliceRunner.Id, before))
		})
		isDone(t, callTool(t, app, alice, "set_photo", with(args, token)))
		if after := avatar(fx.AliceRunner); after == before || after == "" {
			t.Errorf("the photo is %q, was %q", after, before)
		}
	})

	t.Run("remove: a confirmation, then none, by a JSON request", func(t *testing.T) {
		before := avatar(fx.AliceRunner)
		args := map[string]any{"remove": true}
		var token string
		writesNothing(t, app, func() {
			var message string
			var details []string
			token, message, details = asked(t, callTool(t, app, alice, "set_photo", args))
			mentions(t, message, details, "La photo actuelle d'Alice serait retirée", fileURL("runners", fx.AliceRunner.Id, before))
		})
		result := isDone(t, callTool(t, app, alice, "set_photo", with(args, token)))
		if got := avatar(fx.AliceRunner); got != "" {
			t.Errorf("Alice still has the photo %q", got)
		}
		if got := (*updates)[len(*updates)-1]; got != "application/json" {
			t.Errorf("the removal was sent as %q, want JSON", got)
		}
		assertJSON(t, result.Structured["runner"], map[string]any{"id": fx.AliceRunner.Id, "name": "Alice"})
		if summary := summaryOfResult(result); summary != "La photo d'Alice est retirée." {
			t.Errorf("the summary is %q", summary)
		}
	})

	t.Run("remove when there is none: nothing to do", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, alice, "set_photo", map[string]any{"remove": true}))
			if summary := summaryOfResult(result); summary != "Rien à changer : Alice n'a pas de photo." {
				t.Errorf("the summary is %q", summary)
			}
		})
	})

	t.Run("from content_base64: written", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "set_photo", map[string]any{"content_base64": b64(png)}))
		if avatar(fx.AliceRunner) == "" {
			t.Fatal("Alice has no photo")
		}
		if summary := summaryOfResult(result); summary != "La photo d'Alice est changée." {
			t.Errorf("the summary is %q", summary)
		}
	})

	t.Run("600 Ko in base64: refused", func(t *testing.T) {
		big := b64(photoOf(600 << 10))
		writesNothing(t, app, func() {
			result := callTool(t, app, alice, "set_photo", map[string]any{"content_base64": big})
			failsWith(t, result, "set_photo", "512 Ko")
			failsWith(t, result, "set_photo", " : passe par start_upload.")
		})
	})

	t.Run("Alice on Bob's runner: the announced refusal", func(t *testing.T) {
		announced(t, app, alice, "set_photo", map[string]any{"runner": "Bob", "content_base64": b64(png)},
			"La photo de Bob ne peut être changée que depuis son propre compte, ou par un admin.")
		announced(t, app, alice, "set_photo", map[string]any{"runner": "Sam", "remove": true},
			"La photo de Sam ne peut être changée que par un admin : Sam n'a pas de compte.")
	})

	t.Run("the admin on Bob's: a confirmation, then written", func(t *testing.T) {
		args := map[string]any{"runner": "bob", "content_base64": b64(png)}
		var token string
		writesNothing(t, app, func() {
			var message string
			var details []string
			token, message, details = asked(t, callTool(t, app, admin, "set_photo", args))
			mentions(t, message, details, "Bob n'est pas ton coureur")
		})
		result := isDone(t, callTool(t, app, admin, "set_photo", with(args, token)))
		name := avatar(fx.BobRunner)
		assertJSON(t, result.Structured["runner"], map[string]any{"id": fx.BobRunner.Id, "name": "Bob", "photo_url": fileURL("runners", fx.BobRunner.Id, name)})
	})

	t.Run("both upload_id and content_base64, or neither: refused", func(t *testing.T) {
		id := uploaded(t, app, alice, "photo", png)
		announced(t, app, alice, "set_photo", map[string]any{"upload_id": id, "content_base64": b64(png)}, "pas les deux")
		announced(t, app, alice, "set_photo", map[string]any{}, "Il manque la photo")
		announced(t, app, alice, "set_photo", map[string]any{"remove": true, "content_base64": b64(png)}, "remove")
		announced(t, app, alice, "set_photo", map[string]any{"content_base64": "pas du base64 !"}, "base64")
	})

	t.Run("a slot of Bob's token used by Alice: upload_invalid", func(t *testing.T) {
		id := uploaded(t, app, bob, "photo", png)
		announced(t, app, alice, "set_photo", map[string]any{"upload_id": id}, "Cet envoi n'est pas valide, ou il a expiré. (upload_invalid)")
		// A track slot of Alice's is no photo either.
		announced(t, app, alice, "set_photo", map[string]any{"upload_id": uploaded(t, app, alice, "track", testutil.GPX(t, 3))}, "(upload_invalid)")
		// Alice's attempt left Bob's slot where it was.
		asked(t, callTool(t, app, bob, "set_photo", map[string]any{"upload_id": id, "runner": "Bob"}))
	})

	t.Run("a slot whose file has not come yet", func(t *testing.T) {
		s := startUpload(t, app, alice, "photo")
		announced(t, app, alice, "set_photo", map[string]any{"upload_id": s.ID}, "pas encore arrivé")
	})

	// The site re-encodes a photo in the browser, which drops its metadata: the tool
	// takes them out (where it was taken first), without re-encoding it.
	t.Run("a photo of a phone: kept without its GPS", func(t *testing.T) {
		phone := jpegWithGPS(t)
		result := isDone(t, callTool(t, app, admin, "set_photo", with(map[string]any{"runner": "Sam", "content_base64": b64(phone)}, confirmationFor(t, app, admin, "set_photo", map[string]any{"runner": "Sam", "content_base64": b64(phone)}))))
		address := result.Structured["runner"].(map[string]any)["photo_url"].(string)
		kept := served(t, app, pathOf(address), "image/jpeg")
		if bytes.Contains(kept, []byte(gpsDay)) || bytes.Contains(kept, []byte("GPSLatitude")) {
			t.Error("the photo kept still holds where it was taken")
		}
		if !bytes.Contains(kept, minimalOrientation) {
			t.Error("the photo kept lost its orientation")
		}
	})

	t.Run("a GIF: the site's message for the photo", func(t *testing.T) {
		announced(t, app, alice, "set_photo", map[string]any{"content_base64": b64(gifImage(t))},
			"photo : ce type d'image n'est pas accepté : JPEG, PNG ou WebP. (validation_invalid_mime_type)")
	})
}

// trackNumbers are the numbers of the answer for a track, as the tool rounds
// them.
func trackNumbers(t *testing.T, data []byte) map[string]any {
	t.Helper()
	stats := mcp.StatsOf(mustParse(t, data))
	out := map[string]any{
		"points":           stats.Points,
		"distance_km":      math.Round(stats.DistanceKm*100) / 100,
		"elevation_gain_m": math.Round(stats.ElevationGainM),
		"elevation_loss_m": math.Round(stats.ElevationLossM),
		"has_elevation":    stats.HasElevation,
	}
	if stats.HasElevation {
		out["min_m"] = math.Round(stats.MinM*10) / 10
		out["max_m"] = math.Round(stats.MaxM*10) / 10
	}
	return out
}

func TestTools_SetTrack(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	bob := newToken(t, app, fx.Bob)
	gpx := testutil.GPX(t, 50)
	updates := updatesOf(app, "formats")
	trackOf := func(f *core.Record) string {
		t.Helper()
		return storedRecord(t, app, "formats", f.Id).GetString("gpx")
	}

	t.Run("Bob puts a track on Alice's F42 from an upload: written at once", func(t *testing.T) {
		id := uploaded(t, app, bob, "track", gpx)
		result := isDone(t, callTool(t, app, bob, "set_track", map[string]any{"format_id": fx.F42.Id, "upload_id": id}))
		name := trackOf(fx.F42)
		if !strings.HasSuffix(name, ".gpx") {
			t.Fatalf("F42's track is %q", name)
		}
		address := fileURL("formats", fx.F42.Id, name)
		assertJSON(t, result.Structured["format"], map[string]any{"id": fx.F42.Id, "title": "Trail 42 km", "track_url": address})
		want := trackNumbers(t, gpx)
		assertJSON(t, result.Structured["track"], want)
		if want["points"] != 50 || want["distance_km"].(float64) < 5 || want["max_m"].(float64) < 700 || want["min_m"] != 450.0 {
			t.Errorf("the numbers of the test track are %v", want)
		}
		if got := served(t, app, pathOf(address), ""); !bytes.Equal(got, gpx) {
			t.Errorf("the track is %d bytes, not the %d sent", len(got), len(gpx))
		}
		if got := storedRecord(t, app, "formats", fx.F42.Id).GetFloat("distance_km"); got != 42 {
			t.Errorf("F42 is now %v km, want 42 still", got)
		}
		if summary := summaryOfResult(result); !strings.HasPrefix(summary, "La trace de « Trail 42 km » (« Trail des Crêtes ») est enregistrée") {
			t.Errorf("the summary is %q", summary)
		}
	})

	t.Run("a GPX without the XML declaration: accepted, with one", func(t *testing.T) {
		bare := bytes.TrimPrefix(gpx, []byte(xmlDeclaration+"\n"))
		isDone(t, callTool(t, app, bob, "set_track", map[string]any{"format_id": fx.F15.Id, "content_base64": b64(bare)}))
		got := served(t, app, pathOf(fileURL("formats", fx.F15.Id, trackOf(fx.F15))), "")
		if want := xmlDeclaration + "\n" + string(bare); string(got) != want {
			t.Errorf("the track kept is %.80q, want %.80q", got, want)
		}
	})

	t.Run("use_track_values: the distance and the D+ of the format are the track's, in one request", func(t *testing.T) {
		f10 := create(t, app, "formats", map[string]any{"event": fx.Event.Id, "race_type": fx.Trail.Id, "distance_km": 10, "elevation_gain_m": 100})
		stats := mcp.StatsOf(mustParse(t, gpx))
		before := len(*updates)
		result := isDone(t, callTool(t, app, bob, "set_track", map[string]any{"format_id": f10.Id, "content_base64": b64(gpx), "use_track_values": true}))
		stored := storedRecord(t, app, "formats", f10.Id)
		if want := math.Round(stats.DistanceKm*10) / 10; stored.GetFloat("distance_km") != want {
			t.Errorf("the distance is %v, want %v", stored.GetFloat("distance_km"), want)
		}
		if want := int(math.Round(stats.ElevationGainM)); stored.GetInt("elevation_gain_m") != want {
			t.Errorf("the D+ is %v, want %v", stored.GetInt("elevation_gain_m"), want)
		}
		if got := len(*updates) - before; got != 1 {
			t.Errorf("%d update requests, want one", got)
		}
		if title := result.Structured["format"].(map[string]any)["title"]; title != "Trail "+number(math.Round(stats.DistanceKm*10)/10)+" km" {
			t.Errorf("the title is %v", title)
		}
		if summary := summaryOfResult(result); !strings.Contains(summary, "l'épreuve reprend la distance et le D+ de la trace") {
			t.Errorf("the summary is %q", summary)
		}
	})

	t.Run("use_track_values without altitudes: the distance only", func(t *testing.T) {
		f5 := create(t, app, "formats", map[string]any{"event": fx.Event.Id, "race_type": fx.Trail.Id, "distance_km": 5, "elevation_gain_m": 120})
		flat := gpxDoc(`<trkpt lat="45" lon="6"/><trkpt lat="45.01" lon="6"/>`)
		isDone(t, callTool(t, app, bob, "set_track", map[string]any{"format_id": f5.Id, "content_base64": b64(flat), "use_track_values": true}))
		stored := storedRecord(t, app, "formats", f5.Id)
		if stored.GetFloat("distance_km") != 1.1 || stored.GetInt("elevation_gain_m") != 120 {
			t.Errorf("the format is %v km and %v m D+, want 1.1 and 120", stored.GetFloat("distance_km"), stored.GetInt("elevation_gain_m"))
		}
	})

	t.Run("again: a confirmation, then replaced", func(t *testing.T) {
		before := trackOf(fx.F42)
		args := map[string]any{"format_id": fx.F42.Id, "upload_id": uploaded(t, app, bob, "track", testutil.GPX(t, 10))}
		var token string
		writesNothing(t, app, func() {
			var message string
			var details []string
			token, message, details = asked(t, callTool(t, app, bob, "set_track", args))
			mentions(t, message, details, "La trace actuelle de « Trail 42 km » (« Trail des Crêtes ») serait remplacée", fileURL("formats", fx.F42.Id, before))
		})
		isDone(t, callTool(t, app, bob, "set_track", with(args, token)))
		if after := trackOf(fx.F42); after == before || after == "" {
			t.Errorf("the track is %q, was %q", after, before)
		}
	})

	t.Run("remove: a confirmation, then none, by a JSON request", func(t *testing.T) {
		before := trackOf(fx.F42)
		args := map[string]any{"format_id": fx.F42.Id, "remove": true}
		var token string
		writesNothing(t, app, func() {
			var message string
			var details []string
			token, message, details = asked(t, callTool(t, app, bob, "set_track", args))
			mentions(t, message, details, "La trace actuelle de « Trail 42 km » (« Trail des Crêtes ») serait retirée", fileURL("formats", fx.F42.Id, before))
		})
		result := isDone(t, callTool(t, app, bob, "set_track", with(args, token)))
		if got := trackOf(fx.F42); got != "" {
			t.Errorf("F42 still has the track %q", got)
		}
		if got := (*updates)[len(*updates)-1]; got != "application/json" {
			t.Errorf("the removal was sent as %q, want JSON", got)
		}
		if _, ok := result.Structured["track"]; ok {
			t.Error("a removal answers a track")
		}
		assertJSON(t, result.Structured["format"], map[string]any{"id": fx.F42.Id, "title": "Trail 42 km"})
		if summary := summaryOfResult(result); summary != "La trace de « Trail 42 km » (« Trail des Crêtes ») est retirée." {
			t.Errorf("the summary is %q", summary)
		}
	})

	t.Run("remove when there is none: nothing to do", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, bob, "set_track", map[string]any{"format_id": fx.F42.Id, "remove": true}))
			if summary := summaryOfResult(result); summary != "Rien à changer : « Trail 42 km » (« Trail des Crêtes ») n'a pas de trace." {
				t.Errorf("the summary is %q", summary)
			}
		})
	})

	t.Run("a file with no point: refused, nothing sent", func(t *testing.T) {
		for _, data := range [][]byte{gpxDoc(""), []byte("pas du XML"), testutil.PNG(t, 4, 4)} {
			announced(t, app, bob, "set_track", map[string]any{"format_id": fx.F42.Id, "content_base64": b64(data)},
				"Ce fichier n'est pas une trace GPX exploitable.")
		}
	})

	t.Run("a format that is not one", func(t *testing.T) {
		announced(t, app, bob, "set_track", map[string]any{"format_id": "nope", "content_base64": b64(gpx)}, "n'est pas un identifiant d'épreuve")
		announced(t, app, bob, "set_track", map[string]any{"format_id": "aaaaaaaaaaaaaaa", "content_base64": b64(gpx)}, "Introuvable")
	})

	t.Run("use_track_values with remove: refused", func(t *testing.T) {
		announced(t, app, bob, "set_track", map[string]any{"format_id": fx.F15.Id, "remove": true, "use_track_values": true}, "use_track_values")
	})
}

// number writes a number as the site does in French: a comma before the
// decimals.
func number(v float64) string {
	return strings.ReplaceAll(strconv.FormatFloat(v, 'f', -1, 64), ".", ",")
}

// confirmationFor is the token of the confirmation that a first call asks for.
func confirmationFor(t *testing.T, app *tests.TestApp, token, tool string, args map[string]any) string {
	t.Helper()
	given, _, _ := asked(t, callTool(t, app, token, tool, args))
	return given
}

// The track of a slot is read once, at its PUT: the calls of set_track use what
// it read, however many there are (a first call that asks for a confirmation can
// be made again and again).
func TestTools_SetTrack_ReadsATrackOnce(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	bob := newToken(t, app, fx.Bob)
	withFile(t, app, fx.F42, "gpx", "trace.gpx", testutil.GPX(t, 10))
	var parses atomic.Int32
	mcp.SetTrackParseHook(t, func(int) { parses.Add(1) })

	gpx := testutil.GPX(t, 40)
	args := map[string]any{"format_id": fx.F42.Id, "upload_id": uploaded(t, app, bob, "track", gpx)}
	if got := parses.Load(); got != 1 {
		t.Fatalf("the PUT parsed the track %d times, want once", got)
	}
	var token string
	for range 20 {
		token, _, _ = asked(t, callTool(t, app, bob, "set_track", args))
	}
	result := isDone(t, callTool(t, app, bob, "set_track", with(args, token)))
	if got := parses.Load(); got != 1 {
		t.Errorf("the track was parsed %d times in all, want once", got)
	}
	assertJSON(t, result.Structured["track"], trackNumbers(t, gpx))
}

// A track in base64 that waits for a place to be read waits as long as its
// request: a call whose client went away keeps neither its body nor its file.
func TestTools_SetTrack_WaitsForAPlaceAsLongAsItsRequest(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mux := serveMux(t, app)
	bob := newToken(t, app, fx.Bob)
	release := holdTheParses(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		postTo(ctx, t, mux, bob, "tools/call", map[string]any{"name": "set_track",
			"arguments": map[string]any{"format_id": fx.F42.Id, "content_base64": b64(bigTrack(t))}})
	}()
	// The time for the call to read its format and to come to the wait.
	select {
	case <-done:
		t.Fatal("a large track in base64 was answered with both places taken")
	case <-time.After(500 * time.Millisecond):
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Error("the call of a request that ended still waits for a place")
	}
	release()
	<-done
	if format, err := app.FindRecordById("formats", fx.F42.Id); err != nil || format.GetString("gpx") != "" {
		t.Errorf("the format after a call whose request ended: %v, %v; want no track", format, err)
	}
}

// A confirmation is good as long as the file it was asked for: when the file of
// the slot goes first, the confirmation says so, and ends with it.
func TestTools_Confirmation_EndsWithItsFile(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	start := at(2026, 5, 1, 10, 0)
	mcp.SetNow(t, start)
	alice := newToken(t, app, fx.Alice)
	withFile(t, app, fx.AliceRunner, "avatar", "avatar.png", testutil.PNG(t, 16, 16))
	args := map[string]any{"upload_id": uploaded(t, app, alice, "photo", testutil.PNG(t, 20, 20))}

	// Eight minutes later, the file has two left.
	mcp.SetNow(t, start.Add(8*time.Minute))
	first := callTool(t, app, alice, "set_photo", args)
	confirmation, _ := first.Structured["confirmation"].(map[string]any)
	if got := confirmation["expires_at"]; got != "2026-05-01T10:10:00Z" {
		t.Errorf("expires_at = %v, want the end of the file, 10:10", got)
	}
	message, _ := confirmation["message"].(string)
	if !strings.Contains(message, "valable 2 minutes, le temps que le fichier envoyé reste gardé, une seule fois") {
		t.Errorf("the message is %q, want it to say the 2 minutes of the file", redact(message))
	}
	token, _ := confirmation["token"].(string)

	// Within them, it is done.
	mcp.SetNow(t, start.Add(9*time.Minute+30*time.Second))
	isDone(t, callTool(t, app, alice, "set_photo", with(args, token)))
}
