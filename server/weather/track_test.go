package weather_test

import (
	"bytes"
	"strings"
	"testing"

	"courses/server/weather"
)

func TestWeather_TrackStart(t *testing.T) {
	const head = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">`
	for _, row := range []struct {
		name     string
		gpx      string
		ok       bool
		lat, lon float64
		ele      *float64
	}{
		{"a trkpt with its altitude", head + `<trk><trkseg><trkpt lat="45.5" lon="6.5"><ele>1234.5</ele></trkpt><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`, true, 45.5, 6.5, ptr(1234.5)},
		{"a trkpt without altitude", head + `<trk><trkseg><trkpt lat="45.5" lon="6.5"><time>2026-06-13T08:00:00Z</time></trkpt></trkseg></trk></gpx>`, true, 45.5, 6.5, nil},
		{"an altitude that is no number", head + `<trk><trkseg><trkpt lat="45.5" lon="6.5"><ele>high</ele></trkpt></trkseg></trk></gpx>`, true, 45.5, 6.5, nil},
		{"a rtept when there is no trkpt", head + `<rte><rtept lat="44" lon="5"><ele>10</ele></rtept><rtept lat="1" lon="1"/></rte></gpx>`, true, 44, 5, ptr(10)},
		{"a trkpt over a rtept that comes before", head + `<rte><rtept lat="44" lon="5"/></rte><trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`, true, 45, 6, nil},
		{"no namespace, a prefix", `<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg><g:trkpt lat="45" lon="6"><g:ele>5</g:ele></g:trkpt></g:trkseg></g:trk></g:gpx>`, true, 45, 6, ptr(5)},
		{"a point off the Earth is skipped", head + `<trk><trkseg><trkpt lat="95" lon="6"/><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`, true, 45, 6, nil},
		{"a file with no point", head + `<trk><trkseg/></trk><wpt lat="45" lon="6"/></gpx>`, false, 0, 0, nil},
		{"not XML", `not a track`, false, 0, 0, nil},
		{"a declared encoding is of no matter", `<?xml version="1.0" encoding="ISO-8859-1"?><gpx><trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`, true, 45, 6, nil},
	} {
		t.Run(row.name, func(t *testing.T) {
			lat, lon, ele, ok, err := weather.FirstPoint(strings.NewReader(row.gpx))
			if err != nil || ok != row.ok {
				t.Fatalf("ok = %v, err = %v, want %v", ok, err, row.ok)
			}
			if !ok {
				return
			}
			if lat != row.lat || lon != row.lon {
				t.Errorf("point %v, %v, want %v, %v", lat, lon, row.lat, row.lon)
			}
			if (ele == nil) != (row.ele == nil) || (ele != nil && *ele != *row.ele) {
				t.Errorf("altitude %v, want %v", ele, row.ele)
			}
		})
	}

	t.Run("a big file is not read past 1 MB", func(t *testing.T) {
		var big bytes.Buffer
		big.WriteString(`<gpx><trk><trkseg>`)
		for big.Len() < 5<<20-100 {
			big.WriteString(`<!-- padding padding padding padding padding padding padding -->` + "\n")
		}
		big.WriteString(`<trkpt lat="45" lon="6"/></trkseg></trk></gpx>`)
		counted := &countingReader{r: bytes.NewReader(big.Bytes())}
		_, _, _, ok, err := weather.FirstPoint(counted)
		if err != nil || ok {
			t.Errorf("ok = %v, err = %v, want no point and no error", ok, err)
		}
		if counted.n > weather.MaxTrackRead+4096 {
			t.Errorf("%d bytes read, want at most 1 MB", counted.n)
		}
	})

	t.Run("a point before 1 MB is found in a big file", func(t *testing.T) {
		var big bytes.Buffer
		big.WriteString(`<gpx><trk><trkseg><trkpt lat="45" lon="6"/>`)
		for big.Len() < 5<<20 {
			big.WriteString(`<trkpt lat="1" lon="1"/>`)
		}
		counted := &countingReader{r: bytes.NewReader(big.Bytes())}
		lat, _, _, ok, _ := weather.FirstPoint(counted)
		if !ok || lat != 45 {
			t.Errorf("point %v, %v", lat, ok)
		}
		if counted.n > 64<<10 {
			t.Errorf("%d bytes read: the analysis did not stop at the first point", counted.n)
		}
	})

	t.Run("the first format by day, then by distance", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		// F15 has no date (06-13) and F42 is on 06-14: F15 first.
		w.track(t, w.fx.F42, gpxAt(45.1, 6.1, ""))
		w.track(t, w.fx.F15, gpxAt(46.2, 7.2, ""))
		a := w.answer(t, w.fx.Event.Id)
		if a.Place == nil || a.Place.Source != "track" || a.Place.Format != "Trail 15 km" {
			t.Errorf("place %+v, want the track of « Trail 15 km »", a.Place)
		}
		if got := w.meteo.last("/v1/forecast").Query.Get("latitude"); got != "46.20" {
			t.Errorf("latitude %s, want the one of the first format", got)
		}
	})

	t.Run("a track with no point falls back to the place", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.track(t, w.fx.F15, []byte(`<?xml version="1.0" encoding="UTF-8"?>`+"\n"+
			`<gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg/></trk></gpx>`))
		a := w.answer(t, w.fx.Event.Id)
		if a.Place == nil || a.Place.Source != "place" || a.Place.Name != "Annecy" {
			t.Errorf("place %+v", a.Place)
		}
	})
}

func ptr(v float64) *float64 { return &v }

type countingReader struct {
	r interface{ Read([]byte) (int, error) }
	n int
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += n
	return n, err
}
