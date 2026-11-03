package mcp_test

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"courses/server/mcp"
)

// The reading of a GPX track, ported from the site (parseGpx and gpxStats of
// web/src/features/route/gpx.ts, withXmlDeclaration of
// web/src/features/events/saveEvent.ts). Each test is a case of the site's
// tests (parseGpx.test.tsx, gpx.test.ts, saveEvent.test.ts), named after it.

const gpxNamespace = "http://www.topografix.com/GPX/1/1"

// gpxDoc is a GPX 1.1 file, as the site's tests write it: one track, one
// segment. namespace is the attribute of the root ("" for none).
func gpxDoc(points string, namespace ...string) []byte {
	ns := ` xmlns="` + gpxNamespace + `"`
	if len(namespace) > 0 {
		ns = namespace[0]
	}
	return []byte(`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests"` + ns + `>
  <trk><name>Trace</name><trkseg>` + points + `</trkseg></trk>
</gpx>`)
}

// closeTo is toBeCloseTo of Vitest: |got - want| < 10^-digits / 2.
func closeTo(t *testing.T, what string, got, want float64, digits int) {
	t.Helper()
	if math.Abs(got-want) >= math.Pow(10, -float64(digits))/2 {
		t.Errorf("%s = %v, want %v to %d digits", what, got, want, digits)
	}
}

// track is the points of the positions, as toTrack of the site gives them.
func track(points ...[3]float64) []mcp.TrackPoint {
	out := make([]mcp.TrackPoint, len(points))
	for i, p := range points {
		out[i] = mcp.TrackPoint{Lat: p[0], Lon: p[1]}
		if !math.IsNaN(p[2]) {
			out[i].Ele, out[i].HasEle = p[2], true
		}
	}
	return out
}

// noEle is a position without an altitude, for track.
var noEle = math.NaN()

// climbOf is climb of the site's tests: a track of these altitudes, a little to
// the north at each point (about 11 m).
func climbOf(altitudes ...float64) []mcp.TrackPoint {
	out := make([]mcp.TrackPoint, len(altitudes))
	for i, ele := range altitudes {
		out[i] = mcp.TrackPoint{Lat: 45 + float64(i)/10_000, Lon: 6, Ele: ele, HasEle: true}
	}
	return out
}

// lineOf is line of the site's tests: n points of a straight line to the east,
// with no altitude.
func lineOf(n int) []mcp.TrackPoint {
	out := make([]mcp.TrackPoint, n)
	for i := range out {
		out[i] = mcp.TrackPoint{Lat: 45, Lon: 6 + float64(i)/10_000}
	}
	return out
}

func mustParse(t *testing.T, data []byte) []mcp.TrackPoint {
	t.Helper()
	points, err := mcp.ParseGpx(data)
	if err != nil {
		t.Fatalf("parseGpx: %v", err)
	}
	return points
}

func lats(points []mcp.TrackPoint) []float64 {
	out := make([]float64, len(points))
	for i, p := range points {
		out[i] = p.Lat
	}
	return out
}

func sameFloats(t *testing.T, what string, got, want []float64) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

// ---------------------------------------------------------------------------
// gpxStats (gpx.test.ts)

func TestGpxStats_DistanceDeHaversine(t *testing.T) {
	// One degree of latitude is R × π / 180 on a sphere of radius 6 371 km.
	degree := mcp.StatsOf(track([3]float64{0, 0, noEle}, [3]float64{1, 0, noEle}))
	closeTo(t, "one degree", degree.DistanceKm, 111.195, 2)
	if math.Abs(degree.DistanceKm-111.1949)/111.1949 >= 0.001 {
		t.Errorf("one degree is %v km", degree.DistanceKm)
	}

	// Paris to London, by the law of cosines (343.556 km).
	channel := mcp.StatsOf(track([3]float64{48.8566, 2.3522, noEle}, [3]float64{51.5074, -0.1278, noEle}))
	if math.Abs(channel.DistanceKm-343.556)/343.556 >= 0.001 {
		t.Errorf("Paris to London is %v km", channel.DistanceKm)
	}
}

func TestGpxStats_LaDistanceCumuleLesSegmentsDe0AuPremierPoint(t *testing.T) {
	points := track([3]float64{0, 0, noEle}, [3]float64{1, 0, noEle}, [3]float64{2, 0, noEle})
	if got := mcp.StatsOf(points[:1]).DistanceKm; got != 0 {
		t.Errorf("the first point is at %v km, want 0", got)
	}
	closeTo(t, "the second point", mcp.StatsOf(points[:2]).DistanceKm, 111.195, 2)
	closeTo(t, "the third point", mcp.StatsOf(points).DistanceKm, 222.39, 2)
	if got := mcp.StatsOf(points).Points; got != 3 {
		t.Errorf("%d points, want 3", got)
	}
}

func TestGpxStats_LeBruitSous3mNeComptePas(t *testing.T) {
	if mcp.HysteresisM != 3 {
		t.Errorf("the hysteresis is %v m, want 3", mcp.HysteresisM)
	}

	// A flat track whose altitude shakes by 2 m: nothing climbed, nothing descended.
	flat := make([]float64, 60)
	for i := range flat {
		flat[i] = 100
		if i%2 != 0 {
			flat[i] += 2
		}
	}
	stats := mcp.StatsOf(climbOf(flat...))
	if stats.ElevationGainM != 0 || stats.ElevationLossM != 0 {
		t.Errorf("a flat track climbs %v m and descends %v m", stats.ElevationGainM, stats.ElevationLossM)
	}

	// A real climb of 100 m with the same noise on top: the sum of the rises
	// would be 150 m, the climb is what is above the last valley.
	noisy := make([]float64, 101)
	for i := range noisy {
		noisy[i] = float64(i)
		if i%2 != 0 {
			noisy[i] += 2
		}
	}
	naive := 0.0
	for i := 1; i < len(noisy); i++ {
		if noisy[i] > noisy[i-1] {
			naive += noisy[i] - noisy[i-1]
		}
	}
	if naive <= 140 {
		t.Fatalf("the naive sum is %v, want more than 140", naive)
	}
	stats = mcp.StatsOf(climbOf(noisy...))
	if stats.ElevationGainM < 100 || stats.ElevationGainM > 104 || stats.ElevationLossM != 0 {
		t.Errorf("a noisy climb of 100 m: gain %v, loss %v", stats.ElevationGainM, stats.ElevationLossM)
	}
}

func TestGpxStats_UnEcartDe3mCompteDe2mNon(t *testing.T) {
	for _, row := range []struct {
		altitudes  []float64
		gain, loss float64
	}{
		{[]float64{100, 103}, 3, 0},
		{[]float64{100, 102.9}, 0, 0},
		{[]float64{103, 100}, 0, 3},
		{[]float64{103, 100.1}, 0, 0},
	} {
		stats := mcp.StatsOf(climbOf(row.altitudes...))
		if stats.ElevationGainM != row.gain || stats.ElevationLossM != row.loss {
			t.Errorf("%v: gain %v, loss %v; want %v, %v", row.altitudes, stats.ElevationGainM, stats.ElevationLossM, row.gain, row.loss)
		}
	}
}

func TestGpxStats_UneMonteeDe100mCompte100(t *testing.T) {
	for _, row := range []struct {
		name                 string
		altitudes            []float64
		gain, loss, min, max float64
	}{
		{"up", []float64{0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100}, 100, 0, 0, 100},
		{"down", []float64{100, 80, 60, 40, 20, 0}, 0, 100, 0, 100},
		// Up, down, up again: the two climbs and the descent in between are counted.
		{"hills", []float64{0, 50, 100, 50, 0, 50, 100}, 200, 100, 0, 100},
	} {
		stats := mcp.StatsOf(climbOf(row.altitudes...))
		if stats.ElevationGainM != row.gain || stats.ElevationLossM != row.loss || stats.MinM != row.min || stats.MaxM != row.max || !stats.HasElevation {
			t.Errorf("%s: %+v, want gain %v, loss %v, min %v, max %v", row.name, stats, row.gain, row.loss, row.min, row.max)
		}
	}
}

func TestGpxStats_UnPointSansAltitudeNeCoupePasLaMesure(t *testing.T) {
	stats := mcp.StatsOf(track([3]float64{45, 6, 0}, [3]float64{45.001, 6, noEle}, [3]float64{45.002, 6, 50}))
	if stats.ElevationGainM != 50 || stats.ElevationLossM != 0 || stats.MinM != 0 || stats.MaxM != 50 {
		t.Errorf("%+v, want a gain of 50, from 0 to 50", stats)
	}
}

func TestGpxStats_SansAltitudeNiDeniveleNiExtremesMaisLaDistance(t *testing.T) {
	stats := mcp.StatsOf(lineOf(20))
	if stats.DistanceKm <= 0.1 {
		t.Errorf("the distance is %v km", stats.DistanceKm)
	}
	if stats.ElevationGainM != 0 || stats.ElevationLossM != 0 || stats.HasElevation || stats.MinM != 0 || stats.MaxM != 0 {
		t.Errorf("a track without altitude: %+v", stats)
	}
}

func TestGpxStats_UneTraceVideOuDUnPoint(t *testing.T) {
	if got := mcp.StatsOf(nil); got != (mcp.GpxStats{}) {
		t.Errorf("an empty track: %+v", got)
	}
	want := mcp.GpxStats{Points: 1, MinM: 300, MaxM: 300, HasElevation: true}
	if got := mcp.StatsOf(climbOf(300)); got != want {
		t.Errorf("a track of one point: %+v, want %+v", got, want)
	}
}

// ---------------------------------------------------------------------------
// parseGpx (parseGpx.test.tsx)

func TestParseGpx_TrkptAvecAltitudeEtKmCumules(t *testing.T) {
	points := mustParse(t, gpxDoc(`
      <trkpt lat="45.000000" lon="6.000000"><ele>450.5</ele></trkpt>
      <trkpt lat="45.010000" lon="6.000000"><ele>480</ele></trkpt>
      <trkpt lat="45.020000" lon="6.000000"><ele>470.25</ele></trkpt>`))

	want := []mcp.TrackPoint{
		{Lat: 45, Lon: 6, Ele: 450.5, HasEle: true},
		{Lat: 45.01, Lon: 6, Ele: 480, HasEle: true},
		{Lat: 45.02, Lon: 6, Ele: 470.25, HasEle: true},
	}
	if fmt.Sprint(points) != fmt.Sprint(want) {
		t.Fatalf("points = %+v, want %+v", points, want)
	}
	// 0.01° of latitude is 1.11195 km, on a sphere of 6 371 km.
	closeTo(t, "the second point", mcp.StatsOf(points[:2]).DistanceKm, 1.11195, 4)
	stats := mcp.StatsOf(points)
	closeTo(t, "the third point", stats.DistanceKm, 2.2239, 3)
	if stats.ElevationGainM != 29.5 || stats.ElevationLossM != 9.75 || stats.MinM != 450.5 || stats.MaxM != 480 {
		t.Errorf("stats = %+v", stats)
	}
}

func TestParseGpx_SansLEspaceDeNomsDeGpxOuAvecUnPrefixe(t *testing.T) {
	if got := mustParse(t, gpxDoc(`<trkpt lat="45" lon="6"><ele>10</ele></trkpt>`, "")); len(got) != 1 {
		t.Errorf("without the namespace: %d points, want 1", len(got))
	}
	prefixed := `<g:gpx xmlns:g="` + gpxNamespace + `"><g:trk><g:trkseg><g:trkpt lat="45" lon="6"><g:ele>10</g:ele></g:trkpt></g:trkseg></g:trk></g:gpx>`
	got := mustParse(t, []byte(prefixed))
	if want := []mcp.TrackPoint{{Lat: 45, Lon: 6, Ele: 10, HasEle: true}}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("with a prefix: %+v, want %+v", got, want)
	}
}

func TestParseGpx_PlusieursSegmentsSeSuivent(t *testing.T) {
	points := mustParse(t, []byte(`<gpx xmlns="`+gpxNamespace+`"><trk>
      <trkseg><trkpt lat="45" lon="6"/><trkpt lat="45.01" lon="6"/></trkseg>
      <trkseg><trkpt lat="45.02" lon="6"/></trkseg>
    </trk></gpx>`))
	sameFloats(t, "the latitudes", lats(points), []float64{45, 45.01, 45.02})
	closeTo(t, "the third point", mcp.StatsOf(points).DistanceKm, 2.2239, 3)
}

func TestParseGpx_Rtept(t *testing.T) {
	points := mustParse(t, []byte(`<gpx version="1.1" xmlns="`+gpxNamespace+`">
      <rte><name>Itinéraire</name>
        <rtept lat="46.5" lon="7.25"><ele>1200</ele></rtept>
        <rtept lat="46.51" lon="7.26"/>
      </rte></gpx>`))
	if len(points) != 2 {
		t.Fatalf("%d points, want 2", len(points))
	}
	if want := (mcp.TrackPoint{Lat: 46.5, Lon: 7.25, Ele: 1200, HasEle: true}); points[0] != want {
		t.Errorf("the first point is %+v, want %+v", points[0], want)
	}
	if points[1].HasEle {
		t.Errorf("the second point has an altitude: %+v", points[1])
	}
	if km := mcp.StatsOf(points).DistanceKm; km <= 1 {
		t.Errorf("the route is %v km", km)
	}
}

func TestParseGpx_LaTracePasseAvantLItineraireLesPointsDePassageNeComptentPas(t *testing.T) {
	points := mustParse(t, []byte(`<gpx xmlns="`+gpxNamespace+`">
      <wpt lat="10" lon="10"/>
      <rte><rtept lat="20" lon="20"/><rtept lat="21" lon="21"/></rte>
      <trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk>
    </gpx>`))
	sameFloats(t, "the latitudes", lats(points), []float64{45})
}

func TestParseGpx_SansAltitude(t *testing.T) {
	points := mustParse(t, gpxDoc(`
      <trkpt lat="45.00" lon="6.00"></trkpt>
      <trkpt lat="45.01" lon="6.00"/>
      <trkpt lat="45.02" lon="6.00"><ele></ele></trkpt>
      <trkpt lat="45.03" lon="6.00"><ele>pas un nombre</ele></trkpt>`))
	if len(points) != 4 {
		t.Fatalf("%d points, want 4", len(points))
	}
	for _, p := range points {
		if p.HasEle || p.Ele != 0 {
			t.Errorf("a point without altitude has one: %+v", p)
		}
	}
	stats := mcp.StatsOf(points)
	closeTo(t, "the distance", stats.DistanceKm, 3.3358, 3)
	if stats.ElevationGainM != 0 || stats.ElevationLossM != 0 || stats.HasElevation {
		t.Errorf("stats = %+v", stats)
	}
}

func TestParseGpx_UneAltitudeHorsDuPlausibleComptePourAbsente(t *testing.T) {
	// A file stored on the server is read by every member: an altitude of
	// 1e308 m must not reach the drawing. Up to 100 000 m is kept.
	points := mustParse(t, gpxDoc(`
      <trkpt lat="45.00" lon="6"><ele>1e308</ele></trkpt>
      <trkpt lat="45.01" lon="6"><ele>-1e308</ele></trkpt>
      <trkpt lat="45.02" lon="6"><ele>1e999</ele></trkpt>
      <trkpt lat="45.03" lon="6"><ele>100001</ele></trkpt>
      <trkpt lat="45.04" lon="6"><ele>-100001</ele></trkpt>
      <trkpt lat="45.05" lon="6"><ele>100000</ele></trkpt>
      <trkpt lat="45.06" lon="6"><ele>-430</ele></trkpt>`))
	if len(points) != 7 {
		t.Fatalf("%d points, want 7", len(points))
	}
	var got []string
	for _, p := range points {
		if p.HasEle {
			got = append(got, fmt.Sprint(p.Ele))
		} else {
			got = append(got, "undefined")
		}
	}
	if want := "[undefined undefined undefined undefined undefined 100000 -430]"; fmt.Sprint(got) != want {
		t.Errorf("the altitudes are %v, want %s", got, want)
	}
	stats := mcp.StatsOf(points)
	if stats.MinM != -430 || stats.MaxM != 100_000 {
		t.Errorf("min %v, max %v", stats.MinM, stats.MaxM)
	}

	// A file with nothing but absurd altitudes has no profile, but is still a track.
	absurd := mustParse(t, gpxDoc(`<trkpt lat="45" lon="6"><ele>1e308</ele></trkpt>`))
	if want := []mcp.TrackPoint{{Lat: 45, Lon: 6}}; fmt.Sprint(absurd) != fmt.Sprint(want) {
		t.Errorf("absurd altitudes: %+v", absurd)
	}
}

func TestParseGpx_DesBlancsAvantLaDeclarationXmlSontPermis(t *testing.T) {
	// A file from an editor or a download often starts with a newline or a BOM,
	// which the XML parser refuses before `<?xml`.
	xml := gpxDoc(`<trkpt lat="45" lon="6"><ele>10</ele></trkpt>`)
	for _, lead := range []string{"\n", "  \n\t", "\xEF\xBB\xBF", "\r\n\r\n "} {
		got := mustParse(t, append([]byte(lead), xml...))
		if want := []mcp.TrackPoint{{Lat: 45, Lon: 6, Ele: 10, HasEle: true}}; fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("after %q: %+v", lead, got)
		}
	}
}

func TestParseGpx_UnPointSansPositionUtilisableEstLaisseDeCote(t *testing.T) {
	points := mustParse(t, gpxDoc(`
      <trkpt lat="45" lon="6"/>
      <trkpt lat="abc" lon="6"/>
      <trkpt lon="6"/>
      <trkpt lat="95" lon="6"/>
      <trkpt lat="45" lon="200"/>
      <trkpt lat="" lon="6"/>
      <trkpt lat="45.01" lon="6"/>`))
	sameFloats(t, "the latitudes", lats(points), []float64{45, 45.01})
}

func TestParseGpx_FichierInvalideLeveGpxError(t *testing.T) {
	for _, xml := range []string{
		"",
		"   ",
		"pas du XML",
		"<gpx><trk><trkseg><trkpt lat=",
		// XML, but broken: a closing tag is missing.
		`<gpx xmlns="` + gpxNamespace + `"><trk><trkseg><trkpt lat="45" lon="6"></trkseg></trk></gpx>`,
		// XML, not GPX.
		"<html><body><p>Bonjour</p></body></html>",
		// GPX with nothing to read.
		`<gpx xmlns="` + gpxNamespace + `"></gpx>`,
		string(gpxDoc("")),
		`<gpx xmlns="` + gpxNamespace + `"><rte></rte><wpt lat="45" lon="6"/></gpx>`,
		string(gpxDoc(`<trkpt lat="abc" lon="def"/>`)),
	} {
		if points, err := mcp.ParseGpx([]byte(xml)); err == nil {
			t.Errorf("%.60q was read as %d points", xml, len(points))
		}
	}
}

// ---------------------------------------------------------------------------
// What the site does, and its tests do not say.

// A file with track points has no route read in their place, even when none of
// them has a usable position: the site counts the trkpt elements.
func TestParseGpx_DesPointsDeTraceInutilisablesNeLaissentPasPlaceALItineraire(t *testing.T) {
	xml := `<gpx><rte><rtept lat="20" lon="20"/></rte><trk><trkseg><trkpt lat="abc" lon="6"/></trkseg></trk></gpx>`
	if points, err := mcp.ParseGpx([]byte(xml)); err == nil {
		t.Errorf("read as %+v, want no point", points)
	}
}

// The altitude of a point is its first ele, all its text (textContent): the text
// of the elements inside it, not its comments.
func TestParseGpx_LAltitudeEstLaPremiereDuPoint(t *testing.T) {
	points := mustParse(t, gpxDoc(`<trkpt lat="45" lon="6"><ele>10</ele><ele>20</ele></trkpt>`+
		`<trkpt lat="46" lon="6"><extensions><ele>1<!-- un commentaire -->2<x>3</x></ele></extensions><ele>9</ele></trkpt>`+
		`<trkpt lat="47" lon="6"><ele><![CDATA[ 42 ]]></ele></trkpt>`))
	var got []float64
	for _, p := range points {
		got = append(got, p.Ele)
	}
	sameFloats(t, "the altitudes", got, []float64{10, 123, 42})
}

// The site reads a file as UTF-8 text (File.text()), whatever encoding it
// declares: a track from an older app, declared in ISO-8859-1 with an accent in
// its name, is read for its points.
func TestParseGpx_LEncodageDeclareNeChangeRien(t *testing.T) {
	latin1 := "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<gpx><trk><name>Cr\xEAtes</name><trkseg>" +
		`<trkpt lat="45" lon="6"><ele>10</ele></trkpt></trkseg></trk></gpx>`
	if got := mustParse(t, []byte(latin1)); len(got) != 1 || got[0].Ele != 10 {
		t.Errorf("read as %+v", got)
	}
}

// ---------------------------------------------------------------------------
// What the server adds to the port: it reads what anybody sends.

// A number is read as Number() of JavaScript reads it: blanks around it, a sign,
// an exponent, a hexadecimal; what Go reads and JavaScript does not is not one.
func TestParseGpx_LesNombresCommeJavaScriptLesLit(t *testing.T) {
	for _, row := range []struct {
		lat  string
		want bool
		lat0 float64
	}{
		{" 45 ", true, 45},
		{"\n45.5\t", true, 45.5},
		{"+45", true, 45},
		{"4.5e1", true, 45},
		{".5", true, 0.5},
		{"5.", true, 5},
		{"0x2D", true, 45},
		{"0b101101", true, 45},
		{"0o55", true, 45},
		{"45abc", false, 0},
		{"inf", false, 0},
		{"Infinity", false, 0},
		{"NaN", false, 0},
		{"0x1p-2", false, 0},
		{"4_5", false, 0},
		{"-0x2D", false, 0},
		{"1e-400", true, 0},
	} {
		points, err := mcp.ParseGpx(gpxDoc(`<trkpt lat="` + row.lat + `" lon="6"/><trkpt lat="1" lon="1"/>`))
		if err != nil {
			t.Fatalf("%q: %v", row.lat, err)
		}
		read := len(points) == 2
		if read != row.want || (read && points[0].Lat != row.lat0) {
			t.Errorf("lat=%q: read %v (%+v), want %v (%v)", row.lat, read, points, row.want, row.lat0)
		}
	}
}

// The reader of a file that anybody sends: no entity of a DTD is expanded (none
// is fetched), the elements nest to a bound, and a file over the size of a track
// is not read.
func TestParseGpx_NiEntitesNiProfondeurSansFin(t *testing.T) {
	for _, row := range []struct {
		name string
		xml  string
	}{
		{"an external entity", `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY lat SYSTEM "file:///etc/passwd">]>` +
			`<gpx><trk><trkseg><trkpt lat="&lat;" lon="6"/></trkseg></trk></gpx>`},
		{"an internal entity", `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY lat "45">]>` +
			`<gpx><trk><trkseg><trkpt lat="&lat;" lon="6"/></trkseg></trk></gpx>`},
		{"a billion laughs", `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">` +
			`<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><gpx><trk><name>&c;</name><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`},
		{"too deep", `<gpx><trk><trkseg><trkpt lat="45" lon="6">` + strings.Repeat("<x>", 200) + strings.Repeat("</x>", 200) + `</trkpt></trkseg></trk></gpx>`},
		{"two roots", `<gpx><trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx><gpx/>`},
		{"text after the root", `<gpx><trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>texte`},
		{"a declaration after the start", `<gpx><?xml version="1.0"?><trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`},
		{"a DOCTYPE inside the document", `<gpx><!DOCTYPE gpx><trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`},
	} {
		t.Run(row.name, func(t *testing.T) {
			start := time.Now()
			if points, err := mcp.ParseGpx([]byte(row.xml)); err == nil {
				t.Errorf("read as %+v, want a refusal", points)
			}
			if took := time.Since(start); took > time.Second {
				t.Errorf("took %v", took)
			}
		})
	}

	// The depth of a real file is far from the bound.
	deep := `<gpx><trk><trkseg><trkpt lat="45" lon="6"><extensions>` + strings.Repeat("<x>", 20) + strings.Repeat("</x>", 20) + `</extensions></trkpt></trkseg></trk></gpx>`
	if _, err := mcp.ParseGpx([]byte(deep)); err != nil {
		t.Errorf("a file 25 elements deep: %v", err)
	}

	// Over the size of a track (10 Mo), a file is not read.
	big := bytes.Repeat([]byte(" "), mcp.TrackMaxBytes)
	if _, err := mcp.ParseGpx(append(big, gpxDoc(`<trkpt lat="45" lon="6"/>`)...)); err == nil {
		t.Error("a file over 10 Mo was read")
	}
}

// ---------------------------------------------------------------------------
// withXmlDeclaration (saveEvent.test.ts, uploadTraces)

func TestWithXmlDeclaration(t *testing.T) {
	const declaration = `<?xml version="1.0" encoding="UTF-8"?>`
	const body = `<gpx version="1.1" creator="tests" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="45" lon="6"><ele>450</ele></trkpt></trkseg></trk></gpx>`
	const bom = "\xEF\xBB\xBF" // U+FEFF in UTF-8

	for _, row := range []struct {
		name, in, want string
	}{
		{"un fichier sans déclaration XML en reçoit une, que PocketBase reconnaît comme du XML", body, declaration + "\n" + body},
		{"des espaces avant la balise ne font pas oublier la déclaration", "\n  " + body, declaration + "\n\n  " + body},
		{"une marque d'ordre des octets sans déclaration : la déclaration est la première chose du fichier envoyé", bom + body, declaration + "\n" + body},
		{"un fichier qui a déjà sa déclaration part tel quel, marque d'ordre des octets comprise", bom + declaration + "\n" + body, bom + declaration + "\n" + body},
		{"un fichier qui a sa déclaration après des blancs part tel quel", "\n " + declaration + body, "\n " + declaration + body},
	} {
		t.Run(row.name, func(t *testing.T) {
			got := mcp.WithXmlDeclaration([]byte(row.in))
			if string(got) != row.want {
				t.Errorf("got %.80q, want %.80q", got, row.want)
			}
			if !strings.Contains(row.in, "<?xml") && !bytes.HasPrefix(got, []byte("<?xml")) {
				t.Errorf("the file sent starts with %.10q, want <?xml", got)
			}
		})
	}
}
