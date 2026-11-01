package migrations_test

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"slices"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/testutil"
)

// pngSignature opens every PNG file.
var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// avatarOf returns the avatar file name of a runner, "" when it has none.
func avatarOf(t testing.TB, app core.App, id string) string {
	t.Helper()
	runner, err := app.FindRecordById("runners", id)
	if err != nil {
		t.Fatal(err)
	}
	return runner.GetString("avatar")
}

// withPhoto is a Before that gives Alice a photo, the way the code of the
// application would.
func withPhoto(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	file, err := filesystem.NewFileFromBytes(testutil.PNG(t, 64, 64), "alice.png")
	if err != nil {
		t.Fatal(err)
	}
	runner, err := app.FindRecordById("runners", fx.AliceRunner.Id)
	if err != nil {
		t.Fatal(err)
	}
	runner.Set("avatar", file)
	if err := app.Save(runner); err != nil {
		t.Fatal(err)
	}
	if avatarOf(t, app, fx.AliceRunner.Id) == "" {
		t.Fatal("the photo of Alice was not saved")
	}
}

// The photo is the avatar field of "runners". The rules of the collection do
// not change: the owner and the admin write it, nobody else.
func TestRunnerAvatar(t *testing.T) {
	aliceRunner := func(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
	bobRunner := func(fx testutil.Fixture) *core.Record { return fx.BobRunner }
	samRunner := func(fx testutil.Fixture) *core.Record { return fx.SamRunner }

	// photo is a form with a PNG as the avatar.
	photo := func(t testing.TB, _ testutil.Fixture) (io.Reader, string) {
		return testutil.ImageForm(t, "avatar", "photo.png", testutil.PNG(t, 64, 64))
	}
	// file is a form with these bytes as the avatar.
	file := func(name string, data []byte) func(testing.TB, testutil.Fixture) (io.Reader, string) {
		return func(t testing.TB, _ testutil.Fixture) (io.Reader, string) {
			return testutil.ImageForm(t, "avatar", name, data)
		}
	}
	// noPhoto and hasPhoto check the database after the request.
	noPhoto := func(runner func(testutil.Fixture) *core.Record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			if got := avatarOf(t, app, runner(fx).Id); got != "" {
				t.Errorf("the avatar is %q, want none", got)
			}
		}
	}
	hasPhoto := func(runner func(testutil.Fixture) *core.Record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			if got := avatarOf(t, app, runner(fx).Id); got == "" {
				t.Error("the avatar is empty, want a file")
			}
		}
	}

	// A GIF is not one of the three types of the field.
	gif := append([]byte("GIF89a"), make([]byte, 64)...)
	// A PNG that is one byte over the 5 MiB of the field: the size is checked
	// first, whatever the rest of the file is.
	huge := append(slices.Clone(pngSignature), make([]byte, 5<<20+1-len(pngSignature))...)

	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "alice puts a photo on her runner",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", aliceRunner),
			Form:   photo,
			Status: http.StatusOK,
			After:  hasPhoto(aliceRunner),
		},
		{
			Name:     "alice removes her photo",
			As:       "alice",
			Before:   withPhoto,
			Method:   http.MethodPatch,
			URL:      recordOf("runners", aliceRunner),
			Body:     func(testutil.Fixture) string { return `{"avatar": null}` },
			Status:   http.StatusOK,
			Contains: []string{`"avatar":""`},
			After:    noPhoto(aliceRunner),
		},
		{
			Name:   "alice cannot put a photo on bob's runner",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", bobRunner),
			Form:   photo,
			Status: http.StatusNotFound,
			After:  noPhoto(bobRunner),
		},
		{
			Name:   "anon cannot put a photo on a runner",
			As:     "anon",
			Method: http.MethodPatch,
			URL:    recordOf("runners", samRunner),
			Form:   photo,
			Status: http.StatusNotFound,
			After:  noPhoto(samRunner),
		},
		{
			Name:   "admin puts a photo on a runner without an account",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("runners", samRunner),
			Form:   photo,
			Status: http.StatusOK,
			After:  hasPhoto(samRunner),
		},
		{
			Name:   "admin puts a photo on bob's runner",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("runners", bobRunner),
			Form:   photo,
			Status: http.StatusOK,
			After:  hasPhoto(bobRunner),
		},
		{
			Name:     "a GIF is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      recordOf("runners", aliceRunner),
			Form:     file("animation.gif", gif),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_invalid_mime_type"},
			After:    noPhoto(aliceRunner),
		},
		{
			Name:     "a file over 5 MiB is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      recordOf("runners", aliceRunner),
			Form:     file("huge.png", huge),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_file_size_limit"},
			After:    noPhoto(aliceRunner),
		},
		{
			// The link to an account still never changes through the API, with
			// a photo or without.
			Name:   "alice cannot link her runner to bob's account along with a photo",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", aliceRunner),
			Form: func(t testing.TB, fx testutil.Fixture) (io.Reader, string) {
				var body bytes.Buffer
				form := multipart.NewWriter(&body)
				if err := form.WriteField("user", fx.Bob.Id); err != nil {
					t.Fatal(err)
				}
				part, err := form.CreateFormFile("avatar", "photo.png")
				if err != nil {
					t.Fatal(err)
				}
				if _, err := part.Write(testutil.PNG(t, 64, 64)); err != nil {
					t.Fatal(err)
				}
				if err := form.Close(); err != nil {
					t.Fatal(err)
				}
				return &body, form.FormDataContentType()
			},
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				noPhoto(aliceRunner)(t, app, fx)
				runner, err := app.FindRecordById("runners", fx.AliceRunner.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := runner.GetString("user"); got != fx.Alice.Id {
					t.Errorf("the user of Alice's runner is %q, want %q", got, fx.Alice.Id)
				}
			},
		},
	})
}

// The field is not protected: the site shows a photo with a plain <img>, which
// cannot ask for a file token. Its random name is the secret.
func TestRunnerAvatar_FileReadableWithoutToken(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	withPhoto(t, app, fx)

	runner, err := app.FindRecordById("runners", fx.AliceRunner.Id)
	if err != nil {
		t.Fatal(err)
	}
	url := "/api/files/" + runner.Collection().Id + "/" + runner.Id + "/" + runner.GetString("avatar") + "?thumb=96x96"

	// Not a Row: the body of a PNG has null bytes, which RunRows reads as a
	// sign that the body is not JSON.
	scenario := tests.ApiScenario{
		Method:          http.MethodGet,
		URL:             url,
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"\x89PNG"},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return app },
		// NewApp already registered the cleanup.
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			if got := res.Header.Get("Content-Type"); got != "image/png" {
				t.Errorf("Content-Type = %q, want image/png", got)
			}
		},
	}
	scenario.Test(t)
}

// The migration 9 adds the field, and its rollback takes it away again.
func TestMigrations_RunnerAvatarDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	migration := migrationFile(t, "9_runner_avatar.go")

	avatar := func() core.Field {
		t.Helper()
		runners, err := app.FindCollectionByNameOrId("runners")
		if err != nil {
			t.Fatal(err)
		}
		return runners.Fields.GetByName("avatar")
	}

	field, ok := avatar().(*core.FileField)
	if !ok {
		t.Fatalf("runners.avatar must be a file field, got %T", avatar())
	}
	if field.MaxSelect != 1 || field.MaxSize != 5<<20 || field.Protected || field.Required {
		t.Errorf("runners.avatar = maxSelect %d, maxSize %d, protected %v, required %v; want 1, 5 MiB, false, false",
			field.MaxSelect, field.MaxSize, field.Protected, field.Required)
	}
	if want := []string{"image/jpeg", "image/png", "image/webp"}; !slices.Equal(field.MimeTypes, want) {
		t.Errorf("runners.avatar mime types = %q, want %q", field.MimeTypes, want)
	}
	if want := []string{"96x96", "256x256"}; !slices.Equal(field.Thumbs, want) {
		t.Errorf("runners.avatar thumbs = %q, want %q", field.Thumbs, want)
	}

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if avatar() != nil {
		t.Error("runners.avatar must be gone after the rollback")
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	if _, ok := avatar().(*core.FileField); !ok {
		t.Errorf("runners.avatar must be a file field again, got %T", avatar())
	}
}
