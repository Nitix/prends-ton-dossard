package mcp

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The reading of a GPX track, as the site does it in the browser: parseGpx and
// gpxStats of web/src/features/route/gpx.ts, and withXmlDeclaration of
// web/src/features/events/saveEvent.ts. set_track reads a track as the form
// does before it sends it: a file the form would refuse is refused, and the
// numbers of « Reprendre ces valeurs » are the form's.
//
// The site reads a file that its member chose; the server reads one that an
// assistant sent. So the port reads no more than a track can weigh, expands no
// entity (encoding/xml knows none but XML's own, fetches nothing, and refuses an
// entity that a DTD would declare), and nests elements to a bound.

// trackPoint is a point of a track: its position, and its altitude when the
// file gives one (HasEle). TrackPoint of the site, without km, which statsOf
// works out.
type trackPoint struct {
	Lat, Lon, Ele float64
	HasEle        bool
}

// errNotGpx is a file that cannot be read as a track: not XML, or with no point
// (GpxError of the site).
var errNotGpx = errors.New("mcp: not a GPX track")

// maxElevationM is MAX_ELEVATION_M of the site: an altitude beyond it, up or
// down, is read as missing.
const maxElevationM = 100_000

// maxGpxDepth is how deep the elements of a track may nest: a real file goes to
// seven or eight (gpx, trk, trkseg, trkpt, extensions, and those of an app).
const maxGpxDepth = 64

const (
	// byteOrderMark is the mark that some editors put at the start of a UTF-8
	// file (U+FEFF).
	byteOrderMark = 0xFEFF
	// replacement is what a byte that is not UTF-8 becomes in a text that
	// TextDecoder reads (U+FFFD).
	replacement = string(utf8.RuneError)
)

// parseGpx ports parseGpx of the site: the points of a GPX file, those of its
// track (trkpt, all its segments one after the other), or of its route (rtept)
// when it has no track point. A point without a usable position is left out; an
// altitude that is missing, not a number or beyond maxElevationM is just not
// set. Blanks before the XML declaration are allowed (a newline or a BOM). The
// elements are found by their local name, so the file may or may not declare the
// GPX namespace, and may prefix it.
//
// The site reads the file as UTF-8 text (File.text()), whatever encoding it
// declares, and parses that text: so does the port. A file that is not XML, or
// has no point, is errNotGpx; so is one over trackMaxBytes, nested deeper than
// maxGpxDepth, or with an entity of a DTD.
func parseGpx(data []byte) ([]trackPoint, error) {
	if onTrackParse != nil {
		onTrackParse(len(data))
	}
	if len(data) > trackMaxBytes {
		return nil, errNotGpx
	}
	// The text of the file, as File.text() decodes it, and without the blanks
	// before it (trimStart), the BOM among them.
	text := strings.TrimLeftFunc(strings.ToValidUTF8(string(data), replacement), isJSSpace)

	decoder := xml.NewDecoder(strings.NewReader(text))
	decoder.Strict = true
	// The text is UTF-8 already: the encoding that the declaration names is not
	// the one of the text any more, as for DOMParser.parseFromString.
	decoder.CharsetReader = func(_ string, input io.Reader) (io.Reader, error) { return input, nil }

	r := gpxReader{}
	for first := true; ; first = false {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errNotGpx
		}
		if err := r.read(token, first); err != nil {
			return nil, err
		}
	}
	// A document is one element, closed (encoding/xml says that an element is not
	// closed at the end of the text).
	if r.roots != 1 || r.depth != 0 {
		return nil, errNotGpx
	}

	// The points of the track, otherwise those of the route.
	points := r.trkpt
	if r.trkptElements == 0 {
		points = r.rtept
	}
	out := make([]trackPoint, 0, len(points))
	for _, p := range points {
		out = append(out, p.point())
	}
	if len(out) == 0 {
		return nil, errNotGpx
	}
	return out, nil
}

// gpxReader reads the tokens of a GPX file in order.
type gpxReader struct {
	depth, roots int
	// The points of the track and of the route that have a usable position, in
	// the order of the file.
	trkpt, rtept []*rawPoint
	// How many trkpt elements there are, usable or not: a file with one is a
	// track, whose route is not read (elements.length === 0 of the site).
	trkptElements int
	// open are the points whose element is open, with the depth of their
	// element (nil for a point without a usable position).
	open []pointAt
	// reading are the points whose altitude is being read, with the depth of
	// their ele element.
	reading []pointAt
	// scopes are the namespaces that each open element declares (xmlns, xmlns:p),
	// from the root: a prefix that none of them declares is not XML.
	scopes [][]string
	// doctypes is how many DOCTYPEs the file has: one at most, before its root.
	doctypes int
}

// pointAt is a point, and the depth of one of its elements.
type pointAt struct {
	point *rawPoint
	depth int
}

// rawPoint is a point as it is read: its position, and the text of its first
// ele element (textContent).
type rawPoint struct {
	lat, lon float64
	hasEle   bool
	eleText  strings.Builder
}

// point is the point, with its altitude when it is a plausible number.
func (p *rawPoint) point() trackPoint {
	out := trackPoint{Lat: p.lat, Lon: p.lon}
	if p.hasEle {
		if ele, ok := jsNumber(p.eleText.String()); ok && math.Abs(ele) <= maxElevationM {
			out.Ele, out.HasEle = ele, true
		}
	}
	return out
}

func (r *gpxReader) read(token xml.Token, first bool) error {
	switch t := token.(type) {
	case xml.StartElement:
		if r.depth == 0 {
			r.roots++
		}
		r.depth++
		if r.depth > maxGpxDepth || r.roots > 1 {
			return errNotGpx
		}
		if err := r.checkNames(t); err != nil {
			return err
		}
		switch t.Name.Local {
		case "trkpt":
			r.trkptElements++
			p := newRawPoint(t)
			if p != nil {
				r.trkpt = append(r.trkpt, p)
			}
			r.open = append(r.open, pointAt{p, r.depth})
		case "rtept":
			p := newRawPoint(t)
			if p != nil {
				r.rtept = append(r.rtept, p)
			}
			r.open = append(r.open, pointAt{p, r.depth})
		case "ele":
			// The first ele inside each point that is open and has none yet
			// (getElementsByTagNameNS("*", "ele")[0]): its text, the text of
			// the elements inside it included (textContent).
			for _, o := range r.open {
				if o.point != nil && !o.point.hasEle {
					o.point.hasEle = true
					r.reading = append(r.reading, pointAt{o.point, r.depth})
				}
			}
		}
	case xml.EndElement:
		r.scopes = r.scopes[:len(r.scopes)-1]
		r.reading = slices.DeleteFunc(r.reading, func(p pointAt) bool { return p.depth == r.depth })
		if n := len(r.open); n > 0 && r.open[n-1].depth == r.depth {
			r.open = r.open[:n-1]
		}
		r.depth--
	case xml.CharData:
		for _, p := range r.reading {
			p.point.eleText.Write(t)
		}
		if r.depth == 0 && len(bytes.Trim(t, " \t\r\n")) > 0 {
			// Text out of the element of the document.
			return errNotGpx
		}
	case xml.ProcInst:
		// The declaration is the first thing of a document, or nothing.
		if strings.EqualFold(t.Target, "xml") && !first {
			return errNotGpx
		}
	case xml.Directive:
		// A DOCTYPE is only read past: its entities are not expanded, and a
		// reference to one is refused by the decoder. There is one at most,
		// before the root; no other directive is XML out of a DTD.
		r.doctypes++
		if r.depth > 0 || r.roots > 0 || r.doctypes > 1 || !bytes.HasPrefix(t, []byte("DOCTYPE")) {
			return errNotGpx
		}
	}
	return nil
}

// newRawPoint is the point of a trkpt or rtept element, nil when its position is
// not usable: lat and lon must be numbers, within ±90 and ±180.
func newRawPoint(e xml.StartElement) *rawPoint {
	lat, latOK := jsNumber(attribute(e, "lat"))
	lon, lonOK := jsNumber(attribute(e, "lon"))
	if !latOK || !lonOK || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return nil
	}
	return &rawPoint{lat: lat, lon: lon}
}

// attribute is getAttribute of the DOM: the attribute of that name without a
// prefix, "" when there is none.
func attribute(e xml.StartElement, name string) string {
	for _, a := range e.Attr {
		if a.Name.Space == "" && a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

// The numbers that Number() of JavaScript reads, after its blanks: a decimal,
// with a sign, a fraction or an exponent; or a hexadecimal, binary or octal
// integer, without a sign. ("Infinity" too, which is not finite, so not a number
// here.)
var (
	jsDecimal = regexp.MustCompile(`^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$`)
	jsInteger = regexp.MustCompile(`^0([xX][0-9a-fA-F]+|[bB][01]+|[oO][0-7]+)$`)
)

// jsNumber is numberOf of the site: the number that text holds, as Number()
// reads it, when it is a finite one; a blank is not a 0.
func jsNumber(text string) (float64, bool) {
	text = strings.TrimFunc(text, isJSSpace)
	switch {
	case text == "":
		return 0, false
	case jsDecimal.MatchString(text):
		v, err := strconv.ParseFloat(text, 64)
		// Beyond the largest number, ParseFloat says ±Inf, as Number() does;
		// below the smallest, it gives 0 or the nearest, as Number() does.
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return 0, false
		}
		return v, !math.IsInf(v, 0) && !math.IsNaN(v)
	case jsInteger.MatchString(text):
		base := map[byte]int{'x': 16, 'b': 2, 'o': 8}[text[1]|0x20]
		v := 0.0
		for _, digit := range text[2:] {
			d, _ := strconv.ParseInt(string(digit), base, 64)
			v = v*float64(base) + float64(d)
		}
		return v, !math.IsInf(v, 0)
	}
	return 0, false
}

// ---------------------------------------------------------------------------
// The numbers of a track

// hysteresisM is HYSTERESIS_M of the site: how much a GPS altitude has to move,
// from the last valley (or peak), to count as a climb (or a descent).
const hysteresisM = 3

// earthRadiusKm is the radius of the sphere of the haversine formula.
const earthRadiusKm = 6371

// gpxStats are the numbers of a track (GpxStats of the site): its points, its
// length, its elevation gain and loss (0 without altitudes), and its lowest and
// highest altitudes, when a point has one (HasElevation).
type gpxStats struct {
	Points                                                 int
	DistanceKm, ElevationGainM, ElevationLossM, MinM, MaxM float64
	HasElevation                                           bool
}

// statsOf ports gpxStats (and toTrack, for the distance) of the site: the
// numbers of a track, from all its points. The points without an altitude are
// skipped for the elevation.
func statsOf(points []trackPoint) gpxStats {
	out := gpxStats{Points: len(points)}
	var altitudes []float64
	for i, p := range points {
		if i > 0 {
			out.DistanceKm += haversineKm(points[i-1], p)
		}
		if p.HasEle {
			altitudes = append(altitudes, p.Ele)
		}
	}
	if len(altitudes) == 0 {
		return out
	}
	out.HasElevation = true
	out.MinM, out.MaxM = math.Inf(1), math.Inf(-1)
	for _, ele := range altitudes {
		out.MinM, out.MaxM = math.Min(out.MinM, ele), math.Max(out.MaxM, ele)
	}
	out.ElevationGainM, out.ElevationLossM = climb(altitudes)
	return out
}

// haversineKm is the distance in kilometers between two positions, on a sphere
// (haversineKm of the site, in the same order of operations).
func haversineKm(a, b trackPoint) float64 {
	const radians = math.Pi / 180
	dLat := (b.Lat - a.Lat) * radians
	dLon := (b.Lon - a.Lon) * radians
	sinLat, sinLon := math.Sin(dLat/2), math.Sin(dLon/2)
	h := sinLat*sinLat + math.Cos(a.Lat*radians)*math.Cos(b.Lat*radians)*(sinLon*sinLon)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(h)))
}

// climb ports climb of the site: the elevation gain and loss of a series of
// altitudes, with a hysteresis. The leg in progress goes on to its last peak (or
// valley), and it is counted when the altitude comes back by hysteresisM from
// that extreme, or at the end. A rise (or fall) from the last valley (or peak) of
// hysteresisM or more starts a leg; less is noise.
func climb(altitudes []float64) (gain, loss float64) {
	if len(altitudes) == 0 {
		return 0, 0
	}
	const (
		none = iota
		up
		down
	)
	anchor, extreme, direction := altitudes[0], altitudes[0], none
	for _, ele := range altitudes[1:] {
		switch direction {
		case none:
			if ele-anchor >= hysteresisM {
				direction, extreme = up, ele
			} else if anchor-ele >= hysteresisM {
				direction, extreme = down, ele
			}
		case up:
			if ele > extreme {
				extreme = ele
			} else if extreme-ele >= hysteresisM {
				gain += extreme - anchor
				anchor, extreme, direction = extreme, ele, down
			}
		case down:
			if ele < extreme {
				extreme = ele
			} else if ele-extreme >= hysteresisM {
				loss += anchor - extreme
				anchor, extreme, direction = extreme, ele, up
			}
		}
	}
	// The leg in progress at the end of the track.
	switch direction {
	case up:
		gain += extreme - anchor
	case down:
		loss += anchor - extreme
	}
	return gain, loss
}

// ---------------------------------------------------------------------------
// The declaration that PocketBase needs

// xmlDeclaration is the declaration that a file without one is given.
const xmlDeclaration = `<?xml version="1.0" encoding="UTF-8"?>`

// withXmlDeclaration ports withXmlDeclaration of the site. PocketBase tells the
// type of a file from what it holds, and does not take a GPX file that has no
// XML declaration for XML (it says text/plain and refuses it). A file whose text
// starts with the declaration, after blanks, goes as it is; any other gets one:
// the declaration, a line break, and its text as UTF-8 (File.text() of the site,
// which drops a BOM).
func withXmlDeclaration(data []byte) []byte {
	text := strings.ToValidUTF8(string(data), replacement)
	// File.text() drops the BOM of a UTF-8 file.
	if r, size := utf8.DecodeRuneInString(text); r == byteOrderMark {
		text = text[size:]
	}
	if strings.HasPrefix(strings.TrimLeftFunc(text, isJSSpace), "<?xml") {
		return data
	}
	return []byte(xmlDeclaration + "\n" + text)
}

// ---------------------------------------------------------------------------
// The names of an element, as a browser's XML parser checks them

// maxGpxAttributes is how many attributes an element may have: the root of a
// real file has a dozen (its namespaces and its schema), a point two or three.
const maxGpxAttributes = 64

// xmlNamespace is the namespace of the prefix xml (xml:lang), which needs no
// declaration.
const xmlNamespace = "http://www.w3.org/XML/1998/namespace"

// checkNames refuses what a browser's XML parser refuses in the names of an
// element, and the form of the site with it: an attribute twice (by its name, or
// by two prefixes of one namespace), a prefix that no open element declares. It
// opens the scope of the namespaces that the element declares, which the end of
// the element closes. encoding/xml leaves the prefix of an undeclared name where
// a declared one has its namespace: a name whose space is neither empty, nor xml,
// nor a namespace of an open element, has a prefix that nothing declared.
func (r *gpxReader) checkNames(e xml.StartElement) error {
	if len(e.Attr) > maxGpxAttributes {
		return errNotGpx
	}
	var declared []string
	for i, a := range e.Attr {
		for _, before := range e.Attr[:i] {
			if a.Name == before.Name {
				return errNotGpx
			}
		}
		if a.Name.Space == "xmlns" || (a.Name.Space == "" && a.Name.Local == "xmlns") {
			declared = append(declared, a.Value)
		}
	}
	r.scopes = append(r.scopes, declared)

	if !r.declares(e.Name.Space) {
		return errNotGpx
	}
	for _, a := range e.Attr {
		if a.Name.Space != "xmlns" && !r.declares(a.Name.Space) {
			return errNotGpx
		}
	}
	return nil
}

// declares reports whether space is a namespace that a name may have: none, the
// one of xml, or one that an open element declares.
func (r *gpxReader) declares(space string) bool {
	if space == "" || space == xmlNamespace {
		return true
	}
	for _, scope := range r.scopes {
		if slices.Contains(scope, space) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// A track, read once and at most two at a time

// A parse costs several times the file in memory: some 4 for a real track, up to
// 15 for a crafted one (a million attributes, or namespaces). The large tracks
// (those of a slot, and the larger files in base64) are read two at a time at
// most, whatever the number of calls; a slot's is read once, at its PUT.
const (
	maxTrackParses    = 2
	boundedParseBytes = 64 << 10
)

// trackParses holds a place for each parse of a large track that runs.
var trackParses = make(chan struct{}, maxTrackParses)

// onTrackParse, when set, is told the size of each file that parseGpx reads: the
// tests count the parses with it.
var onTrackParse func(size int)

// readTrack is what the site reads of a track (parseGpx, then gpxStats), the parse
// of a large one waiting for its place.
func readTrack(data []byte) (gpxStats, error) {
	if len(data) > boundedParseBytes {
		trackParses <- struct{}{}
		defer func() { <-trackParses }()
	}
	points, err := parseGpx(data)
	if err != nil {
		return gpxStats{}, err
	}
	return statsOf(points), nil
}
