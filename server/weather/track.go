package weather

import (
	"encoding/xml"
	"io"
	"math"
	"strconv"
	"strings"
)

// maxTrackRead is the most that is read of a track to find its first point.
const maxTrackRead = 1 << 20

// maxNumberText is the longest text of a number that is read.
const maxNumberText = 64

// readFailure is a reader that remembers the error that is not the end of the
// file: a truncated file is not a failure, a disk that cannot be read is.
type readFailure struct {
	r   io.Reader
	err error
}

func (f *readFailure) Read(p []byte) (int, error) {
	n, err := f.r.Read(p)
	if err != nil && err != io.EOF {
		f.err = err
	}
	return n, err
}

// firstPoint reads the first trkpt (else the first rtept) of a GPX: its
// latitude, its longitude and its altitude when it has one. At most 1 MB is
// read, and the analysis stops at the first trkpt. ok is false when there is no
// point in what was read (an unreadable or cut file included); err is only for a
// reader that fails.
//
// A point without a usable position is left out; an altitude that is missing,
// not a number or beyond the Earth is not set. The elements are found by their
// local name, so the namespace is of no matter; the XML is analysed as it
// comes, with no entity expanded and nothing fetched.
func firstPoint(r io.Reader) (lat, lon float64, ele *float64, ok bool, err error) {
	source := &readFailure{r: io.LimitReader(r, maxTrackRead)}
	decoder := xml.NewDecoder(source)
	// The file is read for numbers, which are ASCII in any encoding it declares.
	decoder.CharsetReader = func(_ string, in io.Reader) (io.Reader, error) { return in, nil }

	var route struct {
		lat, lon float64
		ele      *float64
		found    bool
	}
	for {
		token, tokenErr := decoder.Token()
		if tokenErr != nil {
			break
		}
		start, isStart := token.(xml.StartElement)
		if !isStart {
			continue
		}
		name := start.Name.Local
		if name != "trkpt" && name != "rtept" {
			continue
		}
		pLat, pLon, pEle, valid := readPoint(decoder, start)
		if !valid {
			continue
		}
		if name == "trkpt" {
			return pLat, pLon, pEle, true, nil
		}
		if !route.found {
			route.lat, route.lon, route.ele, route.found = pLat, pLon, pEle, true
		}
	}
	if source.err != nil {
		return 0, 0, nil, false, source.err
	}
	if route.found {
		return route.lat, route.lon, route.ele, true, nil
	}
	return 0, 0, nil, false, nil
}

// readPoint reads a point whose start has been read, up to its end, and gives
// its position and altitude. valid is false when the position is not usable or
// the file ends inside the point.
func readPoint(decoder *xml.Decoder, start xml.StartElement) (lat, lon float64, ele *float64, valid bool) {
	var haveLat, haveLon bool
	for _, a := range start.Attr {
		switch a.Name.Local {
		case "lat":
			lat, haveLat = number(a.Value)
		case "lon":
			lon, haveLon = number(a.Value)
		}
	}
	depth := 1
	for depth > 0 {
		token, err := decoder.Token()
		if err != nil {
			return 0, 0, nil, false
		}
		switch t := token.(type) {
		case xml.StartElement:
			if depth == 1 && t.Name.Local == "ele" {
				var text string
				if err := decoder.DecodeElement(&text, &t); err != nil {
					return 0, 0, nil, false
				}
				if v, ok := number(text); ok && v >= -500 && v <= 9000 {
					ele = &v
				}
				continue
			}
			depth++
		case xml.EndElement:
			depth--
		}
	}
	if !haveLat || !haveLon || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, nil, false
	}
	return lat, lon, ele, true
}

// number reads a finite number from a text of 64 characters at most, the blanks
// around it apart.
func number(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > maxNumberText {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	return v, true
}
