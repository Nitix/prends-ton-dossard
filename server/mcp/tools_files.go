package mcp

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/apperr"
	"courses/server/wording"
)

// This file has the tools of the files (spec § 6.9): start_upload, which opens
// an upload slot (uploads.go), and set_photo and set_track, which send a file
// to the site as its forms do, as a field of a multipart form: the photo of a
// runner (runners.avatar), the GPX track of a format (formats.gpx). A file comes
// in base64 when it is small, or from a slot. It is sent as it came, but for
// what the site does too (the XML declaration of a track): the field of the site
// is the last word on its type and its size.
//
// Replacing or removing a photo or a track asks for a confirmation, and so does
// the photo of somebody else (spec § 6.13). The first call only looks at the
// file of a slot (peek), whose hash binds the confirmation; the call that writes
// takes it (take).

// ---------------------------------------------------------------------------
// The file of a call

// fileInput resolves a tool's upload_id or content_base64 (exactly one) into
// its file: the bytes, and the type: for a photo, told from what it holds (the
// tool refuses a type that the site would); for a track, the type it is sent with.
// The file of a slot says when the slot expires, and, for a track, what its PUT
// read of it (a slot's track is never read again); one in base64 says neither.
// With consume false (before guard) a slot is peeked; with true (once guard has
// let the call through) it is taken. A file in base64 is the same either way.
func (t *tools) fileInput(ctx context.Context, p uploadPurpose, uploadID, content string, consume bool) (storedFile, error) {
	uploadID, content = strings.TrimSpace(uploadID), strings.TrimSpace(content)
	switch {
	case uploadID != "" && content != "":
		return storedFile{}, errors.New("Donne le fichier par upload_id ou par content_base64, pas les deux.")
	case uploadID == "" && content == "":
		return storedFile{}, errors.New(missingFile[p])
	case content != "":
		data, err := decodeBase64(content)
		if err != nil {
			return storedFile{}, errors.New("content_base64 n'est pas du base64 valide (alphabet standard, avec ou sans « = » à la fin).")
		}
		if len(data) > inlineMaxBytes {
			return storedFile{}, fmt.Errorf("En base64, un fichier fait %d Ko au plus une fois décodé, et celui-ci en fait %d : passe par start_upload.",
				inlineMaxBytes>>10, (len(data)+1023)>>10)
		}
		if p == purposePhoto {
			return storedFile{data: data, contentType: http.DetectContentType(data)}, nil
		}
		return storedFile{data: data, contentType: trackType}, nil
	}

	// A mistake of the code, not a refusal: logged, and said with the generic
	// message.
	c, err := callerOf(ctx)
	if err == nil && (c.token == nil || t.uploads == nil) {
		err = errors.New("mcp: a file without an MCP token or a store of uploads")
	}
	if err != nil {
		return storedFile{}, describe(t.app, err, nil)
	}
	if !isID(uploadID) {
		return storedFile{}, uploadRefusal(p, errUploadInvalid)
	}
	get := t.uploads.peek
	if consume {
		get = t.uploads.take
	}
	file, err := get(uploadID, c.token.Id, p)
	if err != nil {
		return storedFile{}, uploadRefusal(p, err)
	}
	return file, nil
}

// missingFile is what a call that gives no file, and does not remove one, is
// told.
var missingFile = map[uploadPurpose]string{
	purposePhoto: "Il manque la photo : upload_id (après start_upload) ou content_base64, ou remove pour retirer celle qui est là.",
	purposeTrack: "Il manque la trace : upload_id (après start_upload) ou content_base64, ou remove pour retirer celle qui est là.",
}

// decodeBase64 reads a file in base64, as an assistant may write it: with line
// breaks, without its padding, in the alphabet of addresses, or as a data: URL
// (whose type says nothing: the file says what it is).
func decodeBase64(content string) ([]byte, error) {
	if rest, ok := strings.CutPrefix(content, "data:"); ok {
		if _, encoded, found := strings.Cut(rest, ";base64,"); found {
			content = encoded
		}
	}
	content = strings.Join(strings.Fields(content), "")
	var err error
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		var data []byte
		if data, err = encoding.DecodeString(content); err == nil {
			return data, nil
		}
	}
	return nil, err
}

// uploadRefusal is what a tool says of a slot that it cannot take: one whose
// file has not come yet, or one that is not valid (upload_invalid, the code of
// the route), without saying why.
func uploadRefusal(p uploadPurpose, err error) error {
	if errors.Is(err, errUploadEmpty) {
		return errors.New("Le fichier n'est pas encore arrivé : lance d'abord la commande que start_upload a donnée (le PUT vers upload_url), puis rappelle cet outil.")
	}
	return fmt.Errorf("%s Recommence : start_upload (purpose %s), la commande qu'il donne, puis cet outil.", codeText(apperr.CodeUploadInvalid), p)
}

// fileHash is the hex SHA-256 of a file: what the arguments of a confirmation
// hold of it (spec § 6.13).
func fileHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// sameFile checks that the file taken is the one that the confirmation was given
// for. A slot is filled once, so it is: this only keeps it true by
// construction.
func sameFile(p uploadPurpose, data []byte, hash string) error {
	if fileHash(data) != hash {
		return uploadRefusal(p, errUploadInvalid)
	}
	return nil
}

// ---------------------------------------------------------------------------
// start_upload

type startUploadIn struct {
	Purpose string `json:"purpose" jsonschema:"photo pour la photo d'un coureur (set_photo), track pour la trace GPX d'une épreuve (set_track)"`
}

type startUploadOut struct {
	UploadID  string `json:"upload_id" jsonschema:"l'identifiant de l'emplacement, à donner à set_photo ou set_track (upload_id) une fois le fichier envoyé"`
	UploadURL string `json:"upload_url" jsonschema:"l'adresse où envoyer le fichier, tel quel, par un PUT"`
	Secret    string `json:"secret" jsonschema:"le secret de l'emplacement : il va dans l'en-tête X-Upload-Secret du PUT, jamais dans une adresse ; ne le montre à personne"`
	ExpiresAt string `json:"expires_at" jsonschema:"jusqu'à quand l'emplacement attend son fichier, puis l'outil qui le prend, en UTC"`
	MaxBytes  int    `json:"max_bytes" jsonschema:"la taille la plus grande du fichier, en octets"`
	Accepted  string `json:"accepted" jsonschema:"les fichiers que le site prend"`
	Command   string `json:"command" jsonschema:"la commande qui envoie le fichier : remplace <fichier> par son chemin, et lance-la dans un terminal"`
}

// accepted says what files the site takes, for each purpose.
var accepted = map[uploadPurpose]string{
	purposePhoto: "JPEG, PNG ou WebP",
	purposeTrack: "GPX (un fichier XML avec les points d'une trace ou d'un itinéraire)",
}

func addStartUpload(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "start_upload",
		Title: "Préparer l'envoi d'un fichier",
		Description: "Prépare l'envoi d'une photo de coureur (JPEG, PNG ou WebP, 5 Mo au plus) ou d'une trace GPX (10 Mo au plus), " +
			"pour un fichier trop gros pour content_base64 (512 Ko). La réponse donne une commande (curl) qui envoie le fichier tel quel à upload_url, " +
			"avec le secret dans l'en-tête X-Upload-Secret : lance-la dans un terminal, en remplaçant <fichier> par son chemin, puis appelle set_photo ou set_track avec upload_id. " +
			"L'emplacement attend 10 minutes ; il sert une fois, et seulement à ce jeton ; un jeton en a deux au plus : un troisième remplace le plus ancien. " +
			"Le secret ne va jamais dans une adresse, et ne se montre à personne.",
		InputSchema: inputSchema[startUploadIn](map[string][]string{"purpose": {string(purposePhoto), string(purposeTrack)}}),
		Annotations: writeAnnotations(false, false),
	}, t.startUpload)
}

func (t *tools) startUpload(ctx context.Context, _ *mcpsdk.CallToolRequest, in startUploadIn) (*mcpsdk.CallToolResult, startUploadOut, error) {
	c, err := callerOf(ctx)
	if err == nil && (c.token == nil || t.uploads == nil) {
		err = errors.New("mcp: an upload without an MCP token or a store of uploads")
	}
	if err != nil {
		return nil, startUploadOut{}, describe(t.app, err, nil)
	}
	p := uploadPurpose(in.Purpose)
	if _, ok := accepted[p]; !ok {
		return nil, startUploadOut{}, errors.New("purpose est photo ou track.")
	}

	id, secret, expires := t.uploads.open(c.user.Id, c.token.Id, p)
	address := t.cfg.AppURL + uploadsPath + "/" + id
	return nil, startUploadOut{
		UploadID:  id,
		UploadURL: address,
		Secret:    secret,
		ExpiresAt: expires.UTC().Format(time.RFC3339),
		MaxBytes:  int(p.maxBytes()),
		Accepted:  accepted[p],
		// The type of a file, not curl's own for --data-binary (a form's): the
		// body is the file, whatever a proxy on the way would read in a form.
		Command: `curl -sS -X PUT -H "` + secretHeader + `: ` + secret + `" -H "Content-Type: application/octet-stream" --data-binary @<fichier> ` + address,
	}, nil
}

// ---------------------------------------------------------------------------
// set_photo

type setPhotoIn struct {
	Runner        string `json:"runner,omitempty" jsonschema:"l'identifiant ou le nom du coureur (list_runners les donne) ; sans lui, le coureur de la personne au nom de qui tu agis"`
	UploadID      string `json:"upload_id,omitempty" jsonschema:"la photo : l'identifiant de l'emplacement de start_upload où elle a été envoyée"`
	ContentBase64 string `json:"content_base64,omitempty" jsonschema:"la photo en base64, 512 Ko au plus une fois décodée (au-delà, start_upload) : JPEG, PNG ou WebP"`
	Remove        bool   `json:"remove,omitempty" jsonschema:"vrai pour retirer la photo, sans en donner une autre"`
	Confirmation  string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in setPhotoIn) confirmationGiven() string { return in.Confirmation }

// photoRunnerOut is the runner of a photo, as it is after the call.
type photoRunnerOut struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	PhotoURL string `json:"photo_url,omitempty" jsonschema:"l'adresse de sa photo ; absente quand il n'en a pas"`
}

type setPhotoOut struct {
	writeStatus
	Runner *photoRunnerOut `json:"runner,omitempty" jsonschema:"le coureur, avec sa photo telle qu'elle est maintenant"`
}

var setPhotoSchema = sync.OnceValue(writeSchema[setPhotoOut])

func addSetPhoto(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "set_photo",
		Title: "Changer ou retirer une photo",
		Description: "Change la photo d'un coureur, comme « Changer la photo » des Réglages, ou la retire (remove). " +
			"La photo est un JPEG, un PNG ou un WebP de 5 Mo au plus : en base64 (content_base64) jusqu'à 512 Ko, sinon par start_upload (upload_id). " +
			"Elle part sans être réencodée (le site la réduit dans le navigateur, pas l'outil), mais sans ses métadonnées (la position GPS, l'appareil, les dates) : l'orientation reste ; le site en fait les vignettes. " +
			"Seul le coureur lui-même ou un admin change une photo : le refus est annoncé. " +
			"Remplacer ou retirer une photo, ou changer celle d'un autre coureur, ne fait rien au premier appel : la réponse dit ce qui changerait et donne un jeton de confirmation.",
		InputSchema:  inputSchema[setPhotoIn](nil),
		OutputSchema: setPhotoSchema(),
		Annotations:  writeAnnotations(true, false),
	}, usesUpConfirmation(t, t.setPhoto))
}

func (t *tools) setPhoto(ctx context.Context, _ *mcpsdk.CallToolRequest, in setPhotoIn) (*mcpsdk.CallToolResult, setPhotoOut, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, setPhotoOut, error) {
		return nil, setPhotoOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, setPhotoOut, error) {
		return nil, setPhotoOut{}, err
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	if in.Remove && (strings.TrimSpace(in.UploadID) != "" || strings.TrimSpace(in.ContentBase64) != "") {
		return refuse(errors.New("remove retire la photo : ne donne pas de fichier avec (upload_id, content_base64)."))
	}

	// 1. Read: the runner, and whose it is.
	runners, err := t.runners(ctx)
	if err != nil {
		return fail(err)
	}
	runner, err := resolveRunner(runners, in.Runner, runnerOfAccount(runners, c.user.Id))
	if err != nil {
		return refuse(err)
	}
	if !isID(runner.ID) {
		return fail(errors.New("mcp: a runner id that is not an id"))
	}
	// 3. The refusal of the site (the rule of runners.update): the runner's own
	// account, or an admin.
	if err := photoRefusal(c, runner); err != nil {
		return refuse(err)
	}
	if in.Remove && runner.Avatar == "" {
		return nil, setPhotoOut{
			writeStatus: writeStatus{Done: true, Summary: "Rien à changer : " + plain(runner.Name) + " n'a pas de photo."},
			Runner:      &photoRunnerOut{ID: runner.ID, Name: runner.Name},
		}, nil
	}

	// 2. Normalize: the file to the hash of its bytes, once it is one the site
	// takes, and whose metadata can be taken out (a photo that cannot be read for
	// them is refused now, not after the person agreed).
	hash := ""
	var until time.Time
	if !in.Remove {
		file, err := t.fileInput(ctx, purposePhoto, in.UploadID, in.ContentBase64, false)
		if err != nil {
			return refuse(err)
		}
		if !slices.Contains(photoTypes, file.contentType) {
			return refuse(errors.New(fieldText("avatar", "validation_invalid_mime_type")))
		}
		if len(file.data) > photoMaxBytes {
			return refuse(errors.New(fieldText("avatar", "validation_file_size_limit")))
		}
		if _, err := stripPhotoMetadata(file.contentType, file.data); err != nil {
			return refuse(errors.New(unreadablePhoto))
		}
		hash, until = fileHash(file.data), file.expires
	}

	// 4, 5. The risk, and guard.
	args := struct {
		Runner string
		Remove bool
		File   string
	}{runner.ID, in.Remove, hash}
	proceed, out, notice, err := t.guard(ctx, "set_photo", args, t.photoRisk(c, runner, in.Remove, until), strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, setPhotoOut{writeStatus: notDoneOut(out, notice)}, nil
	}

	// 6. Write, as the site does: a form with the file, without its metadata (as
	// the site's resizing drops them), or {"avatar": null}.
	var updated runnerRecord
	path := "/api/collections/runners/records/" + runner.ID
	if in.Remove {
		err = t.inner.send(ctx, http.MethodPatch, path, map[string]any{"avatar": nil}, &updated)
	} else {
		file, taken := t.fileInput(ctx, purposePhoto, in.UploadID, in.ContentBase64, true)
		if taken != nil {
			return refuse(taken)
		}
		if err := sameFile(purposePhoto, file.data, hash); err != nil {
			return refuse(err)
		}
		clean, unread := stripPhotoMetadata(file.contentType, file.data)
		if unread != nil {
			return refuse(errors.New(unreadablePhoto))
		}
		err = t.inner.sendForm(ctx, http.MethodPatch, path, nil, []formFile{{Field: "avatar", Name: photoName(file.contentType), ContentType: file.contentType, Data: clean}}, &updated)
	}
	if err != nil {
		return fail(err)
	}

	// 7. Answer.
	summary := "La photo " + ofName(runner.Name) + " est changée."
	if in.Remove {
		summary = "La photo " + ofName(runner.Name) + " est retirée."
	}
	return nil, setPhotoOut{
		writeStatus: writeStatus{Done: true, Summary: summary},
		Runner:      &photoRunnerOut{ID: updated.ID, Name: updated.Name, PhotoURL: photoURL(t.cfg, updated)},
	}, nil
}

// photoRefusal is the refusal that the site gives to a caller who changes the
// photo of a runner that is not theirs, unless an admin. nil when the caller may.
func photoRefusal(c *caller, runner runnerRecord) error {
	switch {
	case c.role == roleAdmin || (runner.User != "" && runner.User == c.user.Id):
		return nil
	case runner.User == "":
		return fmt.Errorf("La photo %s ne peut être changée que par un admin : %s n'a pas de compte.", ofName(runner.Name), plain(runner.Name))
	}
	return fmt.Errorf("La photo %s ne peut être changée que depuis son propre compte, ou par un admin.", ofName(runner.Name))
}

// photoRisk is what set_photo asks a confirmation for (spec § 6.13): a photo
// that is there, replaced or removed, and the photo of somebody else. nil when
// there is none.
func (t *tools) photoRisk(c *caller, runner runnerRecord, remove bool, until time.Time) *risk {
	var lines []string
	if runner.Avatar != "" {
		what := "remplacée"
		if remove {
			what = "retirée"
		}
		lines = append(lines, fmt.Sprintf("La photo actuelle %s serait %s (%s).", ofName(runner.Name), what, photoURL(t.cfg, runner)))
	}
	if runner.User == "" || runner.User != c.user.Id {
		lines = append(lines, plain(runner.Name)+" n'est pas ton coureur : c'est la photo d'un autre coureur que toi que tu changerais.")
	}
	if len(lines) == 0 {
		return nil
	}
	return &risk{
		Message: strings.Join(lines, " "),
		Details: lines,
		Records: []stamp{{Collection: "runners", ID: runner.ID, Updated: runner.Updated}},
		Until:   until,
	}
}

// photoName is the name of the file of a photo, as the site names it: it only
// says its type (uploadAvatar of web/src/lib/avatar.ts).
func photoName(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return "avatar.jpg"
	case "image/webp":
		return "avatar.webp"
	}
	return "avatar.png"
}

// ---------------------------------------------------------------------------
// set_track

type setTrackIn struct {
	FormatID       string `json:"format_id" jsonschema:"l'identifiant de l'épreuve, tel que get_event le donne"`
	UploadID       string `json:"upload_id,omitempty" jsonschema:"la trace : l'identifiant de l'emplacement de start_upload où elle a été envoyée"`
	ContentBase64  string `json:"content_base64,omitempty" jsonschema:"la trace en base64, 512 Ko au plus une fois décodée (au-delà, start_upload) : un fichier GPX"`
	Remove         bool   `json:"remove,omitempty" jsonschema:"vrai pour retirer la trace, sans en donner une autre"`
	UseTrackValues bool   `json:"use_track_values,omitempty" jsonschema:"« Reprendre ces valeurs » : la distance de l'épreuve devient celle de la trace (au dixième de km), et son D+ celui de la trace quand elle a des altitudes, dans la même écriture"`
	Confirmation   string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in setTrackIn) confirmationGiven() string { return in.Confirmation }

// trackFormatOut is the format of a track, as it is after the call.
type trackFormatOut struct {
	ID       string `json:"id"`
	Title    string `json:"title" jsonschema:"comme le site l'écrit : son nom, sinon le type et la mesure (Trail 42 km)"`
	TrackURL string `json:"track_url,omitempty" jsonschema:"l'adresse du fichier de la trace ; absente quand l'épreuve n'en a pas"`
}

// trackOut is what the site reads of a track (gpxStats), rounded for a person.
type trackOut struct {
	Points         int      `json:"points" jsonschema:"le nombre de points de la trace (ou de l'itinéraire, quand le fichier n'a pas de trace)"`
	DistanceKm     float64  `json:"distance_km" jsonschema:"sa longueur, en km, au centième"`
	ElevationGainM float64  `json:"elevation_gain_m" jsonschema:"son D+, en mètres, compté comme le site le compte (le bruit sous 3 m ne compte pas) ; 0 sans altitudes"`
	ElevationLossM float64  `json:"elevation_loss_m" jsonschema:"son D−, en mètres, compté de même ; 0 sans altitudes"`
	MinM           *float64 `json:"min_m,omitempty" jsonschema:"son altitude la plus basse, en mètres ; absente sans altitudes"`
	MaxM           *float64 `json:"max_m,omitempty" jsonschema:"son altitude la plus haute, en mètres ; absente sans altitudes"`
	HasElevation   bool     `json:"has_elevation" jsonschema:"vrai quand des points ont une altitude"`
}

type setTrackOut struct {
	writeStatus
	Format *trackFormatOut `json:"format,omitempty" jsonschema:"l'épreuve, avec sa trace telle qu'elle est maintenant"`
	Track  *trackOut       `json:"track,omitempty" jsonschema:"ce que le site lit de la trace envoyée ; absente quand la trace est retirée"`
}

var setTrackSchema = sync.OnceValue(writeSchema[setTrackOut])

// notATrack is the refusal of a file that parseGpx does not read.
const notATrack = "Ce fichier n'est pas une trace GPX exploitable."

func addSetTrack(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "set_track",
		Title: "Changer ou retirer une trace GPX",
		Description: "Met la trace GPX d'une épreuve, comme « Trace GPX » du formulaire, ou la retire (remove) ; tout membre le peut. " +
			"Le fichier fait 10 Mo au plus : en base64 (content_base64) jusqu'à 512 Ko, sinon par start_upload (upload_id). " +
			"Il est lu comme le site le lit (les points de la trace, sinon de l'itinéraire) : un fichier sans point est refusé, et rien n'est envoyé. " +
			"La réponse donne ce que le site en lit (distance, D+, D−, altitudes). use_track_values fait « Reprendre ces valeurs » : la distance et le D+ de l'épreuve deviennent ceux de la trace. " +
			"Remplacer ou retirer une trace ne fait rien au premier appel : la réponse dit ce qui changerait et donne un jeton de confirmation.",
		InputSchema:  inputSchema[setTrackIn](nil),
		OutputSchema: setTrackSchema(),
		Annotations:  writeAnnotations(true, false),
	}, usesUpConfirmation(t, t.setTrack))
}

// trackFormat is a format with its race type and its event, as set_track reads
// it.
type trackFormat struct {
	formatRecord
	Expand struct {
		RaceType raceTypeRecord `json:"race_type"`
		Event    eventRecord    `json:"event"`
	} `json:"expand"`
}

// label is the format as a sentence names it: « Trail 42 km » (Trail des
// Crêtes).
func (f trackFormat) label(w wording.Words) string {
	title := w.RaceName(f.Name, f.Expand.RaceType.Label, f.DistanceKm, f.DurationMin, f.TimeLimitMin)
	return quote(title) + " (" + quote(f.Expand.Event.Name) + ")"
}

func (t *tools) setTrack(ctx context.Context, _ *mcpsdk.CallToolRequest, in setTrackIn) (*mcpsdk.CallToolResult, setTrackOut, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, setTrackOut, error) {
		return nil, setTrackOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, setTrackOut, error) {
		return nil, setTrackOut{}, err
	}
	id, err := formatIDOf(in.FormatID)
	if err != nil {
		return refuse(err)
	}
	if in.Remove && (strings.TrimSpace(in.UploadID) != "" || strings.TrimSpace(in.ContentBase64) != "") {
		return refuse(errors.New("remove retire la trace : ne donne pas de fichier avec (upload_id, content_base64)."))
	}
	if in.Remove && in.UseTrackValues {
		return refuse(errors.New("use_track_values reprend les valeurs d'une trace envoyée : il ne va pas avec remove."))
	}

	// 1. Read: the format, its race type and its event, and its track.
	path := "/api/collections/formats/records/" + id + "?" + url.Values{"expand": {"race_type,event"}}.Encode()
	var format trackFormat
	if err := t.inner.get(ctx, path, &format); err != nil {
		return fail(err)
	}
	w := wording.Of("fr")
	if in.Remove && format.GPX == "" {
		return nil, setTrackOut{
			writeStatus: writeStatus{Done: true, Summary: "Rien à changer : " + format.label(w) + " n'a pas de trace."},
			Format:      t.trackFormatOut(w, format),
		}, nil
	}

	// 2, 3. Normalize: the file read as the form reads it (refused when it is
	// not a track, as the form refuses it), then hashed. The track of a slot was
	// read at its PUT, once: it is never read again, however many calls come.
	var stats gpxStats
	hash := ""
	var until time.Time
	if !in.Remove {
		file, err := t.fileInput(ctx, purposeTrack, in.UploadID, in.ContentBase64, false)
		if err != nil {
			return refuse(err)
		}
		if file.track != nil {
			stats = *file.track
		} else {
			// The wait for a place ends with the request: nobody reads the answer.
			waiting, stop := untilGone(ctx)
			stats, err = readTrack(waiting, file.data)
			gone := waiting.Err()
			stop()
			switch {
			case err != nil && gone != nil:
				return refuse(gone)
			case err != nil:
				return refuse(errors.New(notATrack))
			}
		}
		hash, until = fileHash(file.data), file.expires
	}

	// 4, 5. The risk, and guard.
	args := struct {
		Format         string
		Remove         bool
		File           string
		UseTrackValues bool
	}{id, in.Remove, hash, in.UseTrackValues}
	proceed, out, notice, err := t.guard(ctx, "set_track", args, t.trackRisk(w, format, in.Remove, until), strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, setTrackOut{writeStatus: notDoneOut(out, notice)}, nil
	}

	// 6. Write, as the site does: a form with the file, and the values of the
	// track when asked, in one request; or {"gpx": null}.
	var updated trackFormat
	if in.Remove {
		err = t.inner.send(ctx, http.MethodPatch, path, map[string]any{"gpx": nil}, &updated)
	} else {
		taken, takeErr := t.fileInput(ctx, purposeTrack, in.UploadID, in.ContentBase64, true)
		if takeErr != nil {
			return refuse(takeErr)
		}
		data := taken.data
		if err := sameFile(purposeTrack, data, hash); err != nil {
			return refuse(err)
		}
		fields := map[string]string{}
		if in.UseTrackValues {
			for name, value := range trackValues(stats) {
				fields[name] = value
			}
		}
		file := formFile{Field: "gpx", Name: "trace.gpx", ContentType: trackType, Data: withXmlDeclaration(data)}
		err = t.inner.sendForm(ctx, http.MethodPatch, path, fields, []formFile{file}, &updated)
	}
	if err != nil {
		return fail(err)
	}

	// 7. Answer.
	answer := setTrackOut{Format: t.trackFormatOut(w, updated)}
	if in.Remove {
		answer.writeStatus = writeStatus{Done: true, Summary: "La trace de " + updated.label(w) + " est retirée."}
		return nil, answer, nil
	}
	answer.Track = newTrackOut(stats)
	summary := "La trace de " + updated.label(w) + " est enregistrée : " + kmText(stats.DistanceKm)
	if stats.HasElevation {
		summary += fmt.Sprintf(", %d m D+", int(math.Round(stats.ElevationGainM)))
	}
	switch {
	case in.UseTrackValues && stats.HasElevation:
		summary += " ; l'épreuve reprend la distance et le D+ de la trace"
	case in.UseTrackValues:
		summary += " ; l'épreuve reprend la distance de la trace (elle n'a pas d'altitudes pour le D+)"
	}
	answer.writeStatus = writeStatus{Done: true, Summary: summary + "."}
	return nil, answer, nil
}

// trackValues are the values of « Reprendre ces valeurs » (reuseTrack of
// FormatFieldset.tsx): the distance to a tenth of a km, and the elevation gain,
// to the meter, when the track has altitudes.
func trackValues(stats gpxStats) map[string]string {
	values := map[string]string{"distance_km": strconv.FormatFloat(math.Round(stats.DistanceKm*10)/10, 'f', -1, 64)}
	if stats.HasElevation {
		values["elevation_gain_m"] = strconv.Itoa(int(math.Round(stats.ElevationGainM)))
	}
	return values
}

// trackRisk is what set_track asks a confirmation for (spec § 6.13): a track that
// is there, replaced or removed. nil when there is none.
func (t *tools) trackRisk(w wording.Words, format trackFormat, remove bool, until time.Time) *risk {
	if format.GPX == "" {
		return nil
	}
	what := "remplacée"
	if remove {
		what = "retirée"
	}
	line := fmt.Sprintf("La trace actuelle de %s serait %s (%s).", format.label(w), what, trackURL(t.cfg, format.formatRecord))
	return &risk{
		Message: line,
		Details: []string{line},
		Records: []stamp{{Collection: "formats", ID: format.ID, Updated: format.Updated}},
		Until:   until,
	}
}

// trackFormatOut is a format of a set_track answer.
func (t *tools) trackFormatOut(w wording.Words, f trackFormat) *trackFormatOut {
	return &trackFormatOut{
		ID:       f.ID,
		Title:    w.RaceName(f.Name, f.Expand.RaceType.Label, f.DistanceKm, f.DurationMin, f.TimeLimitMin),
		TrackURL: trackURL(t.cfg, f.formatRecord),
	}
}

// newTrackOut is what the site reads of a track, rounded: the distance to ten
// meters, the climbs to the meter, the altitudes to the decimeter.
func newTrackOut(stats gpxStats) *trackOut {
	out := &trackOut{
		Points:         stats.Points,
		DistanceKm:     math.Round(stats.DistanceKm*100) / 100,
		ElevationGainM: math.Round(stats.ElevationGainM),
		ElevationLossM: math.Round(stats.ElevationLossM),
		HasElevation:   stats.HasElevation,
	}
	if stats.HasElevation {
		out.MinM = ptr(math.Round(stats.MinM*10) / 10)
		out.MaxM = ptr(math.Round(stats.MaxM*10) / 10)
	}
	return out
}

// kmText writes a distance as the form shows the one of a track: to a tenth of a
// km.
func kmText(km float64) string {
	return number(math.Round(km*10)/10) + " km"
}
