package mcp_test

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"testing"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The metadata of a photo (spec § 6.9): the site re-encodes a photo in the
// browser, which drops them; the tool sends the file without re-encoding it, so it
// takes them out.

// gpsDay is the day of the GPS tag of the test photos: a text that the file holds
// only in its metadata.
const gpsDay = "2026:06:13"

// exifWithGPS is the Exif payload of an APP1 segment: the orientation 6 (turned a
// quarter), and a GPS directory with a latitude and a day.
func exifWithGPS() []byte {
	var b bytes.Buffer
	b.WriteString("Exif\x00\x00")
	b.WriteString("MM\x00\x2a\x00\x00\x00\x08")
	// IFD0: the orientation, and where the GPS directory is (offset 38).
	b.Write([]byte{0, 2})
	b.Write([]byte{0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0})
	b.Write([]byte{0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38})
	b.Write([]byte{0, 0, 0, 0})
	// The GPS directory: the latitude N, and the day (at offset 68).
	b.Write([]byte{0, 2})
	b.Write([]byte{0x00, 0x01, 0, 2, 0, 0, 0, 2, 'N', 0, 0, 0})
	b.Write([]byte{0x00, 0x1d, 0, 2, 0, 0, 0, 11, 0, 0, 0, 68})
	b.Write([]byte{0, 0, 0, 0})
	b.WriteString(gpsDay + "\x00")
	return b.Bytes()
}

// segment is a JPEG segment: its marker, its length, its payload.
func segment(marker byte, payload []byte) []byte {
	out := []byte{0xFF, marker, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	return append(out, payload...)
}

// jpegWithGPS is a JPEG of a phone: an image, with Exif (GPS and orientation),
// XMP, IPTC and a comment, and a second picture after its end.
func jpegWithGPS(t testing.TB) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 8))
	for x := range 16 {
		for y := range 8 {
			img.Pix[img.PixOffset(x, y)] = byte(x * 16)
			img.Pix[img.PixOffset(x, y)+3] = 255
		}
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, nil); err != nil {
		t.Fatal(err)
	}
	data := encoded.Bytes()
	var out bytes.Buffer
	out.Write(data[:2]) // SOI
	out.Write(segment(0xE1, exifWithGPS()))
	out.Write(segment(0xE1, []byte("http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta><exif:GPSLatitude>45,52N</exif:GPSLatitude></x:xmpmeta>")))
	out.Write(segment(0xED, []byte("Photoshop 3.0\x008BIM iptc "+gpsDay)))
	out.Write(segment(0xFE, []byte("commentaire "+gpsDay)))
	out.Write(data[2:])
	out.WriteString("\xFF\xD8 une seconde image, Exif " + gpsDay)
	return out.Bytes()
}

// minimalOrientation is the Exif that a photo keeps: its orientation alone.
var minimalOrientation = []byte("Exif\x00\x00MM\x00\x2a\x00\x00\x00\x08\x00\x01\x01\x12\x00\x03\x00\x00\x00\x01\x00\x06\x00\x00\x00\x00\x00\x00")

func samePixels(t *testing.T, decode func([]byte) (image.Image, error), a, b []byte) {
	t.Helper()
	first, err := decode(a)
	if err != nil {
		t.Fatalf("the original does not decode: %v", err)
	}
	second, err := decode(b)
	if err != nil {
		t.Fatalf("the photo sent does not decode: %v", err)
	}
	if first.Bounds() != second.Bounds() {
		t.Fatalf("bounds %v, want %v", second.Bounds(), first.Bounds())
	}
	for y := first.Bounds().Min.Y; y < first.Bounds().Max.Y; y++ {
		for x := first.Bounds().Min.X; x < first.Bounds().Max.X; x++ {
			if first.At(x, y) != second.At(x, y) {
				t.Fatalf("the pixel %d,%d changed: the image was re-encoded", x, y)
			}
		}
	}
}

func TestStripPhotoMetadata_JPEG(t *testing.T) {
	original := jpegWithGPS(t)
	stripped, err := mcp.StripPhotoMetadata("image/jpeg", original)
	if err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{gpsDay, "GPSLatitude", "Photoshop", "commentaire", "une seconde image"} {
		if bytes.Contains(stripped, []byte(gone)) {
			t.Errorf("the photo sent still holds %q", gone)
		}
	}
	// The orientation stays, alone, so that the photo is shown the right way up.
	if !bytes.Contains(stripped, segment(0xE1, minimalOrientation)) {
		t.Error("the orientation of the photo is not kept")
	}
	if !bytes.HasSuffix(stripped, []byte{0xFF, 0xD9}) {
		t.Error("the photo sent does not end with the end of its image")
	}
	samePixels(t, func(b []byte) (image.Image, error) { return jpeg.Decode(bytes.NewReader(b)) }, original, stripped)

	// A photo without metadata goes as it is.
	plain := original[:2]
	plain = append(plain[:2:2], original[bytes.Index(original, []byte{0xFF, 0xDB}):bytes.LastIndex(original, []byte{0xFF, 0xD9})+2]...)
	again, err := mcp.StripPhotoMetadata("image/jpeg", plain)
	if err != nil || !bytes.Equal(again, plain) {
		t.Errorf("a photo without metadata was changed (%v)", err)
	}
}

// The orientation stays whatever the order of the segments: an ICC profile (kept)
// before the Exif, or JFIF after it.
func TestStripPhotoMetadata_JPEGOrientationWhateverTheOrder(t *testing.T) {
	photo := jpegWithGPS(t) // SOI, Exif, XMP, IPTC, a comment, the image
	exif := segment(0xE1, exifWithGPS())
	icc := segment(0xE2, []byte("ICC_PROFILE\x00\x01\x01profil"))
	jfif := segment(0xE0, []byte("JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"))
	rest := photo[2+len(exif):]

	for _, row := range []struct {
		name  string
		order [][]byte
		want  [][]byte
	}{
		{"ICC, then Exif", [][]byte{icc, exif}, [][]byte{segment(0xE1, minimalOrientation), icc}},
		{"JFIF, then Exif", [][]byte{jfif, exif}, [][]byte{jfif, segment(0xE1, minimalOrientation)}},
		{"Exif, then JFIF", [][]byte{exif, jfif}, [][]byte{jfif, segment(0xE1, minimalOrientation)}},
		{"JFIF, ICC, then Exif", [][]byte{jfif, icc, exif}, [][]byte{jfif, segment(0xE1, minimalOrientation), icc}},
	} {
		t.Run(row.name, func(t *testing.T) {
			original := append([]byte{0xFF, 0xD8}, bytes.Join(row.order, nil)...)
			original = append(original, rest...)
			stripped, err := mcp.StripPhotoMetadata("image/jpeg", original)
			if err != nil {
				t.Fatal(err)
			}
			// The segments kept come first, in that order, the orientation after
			// JFIF and before the rest.
			want := append([]byte{0xFF, 0xD8}, bytes.Join(row.want, nil)...)
			if !bytes.HasPrefix(stripped, want) {
				t.Errorf("the photo sent starts with\n%q\nwant\n%q", stripped[:min(len(stripped), len(want))], want)
			}
			if bytes.Contains(stripped, []byte(gpsDay)) {
				t.Error("the photo sent still holds the GPS day")
			}
		})
	}
}

// chunk is a PNG chunk: its length, its type, its data and its CRC.
func chunk(kind string, data []byte) []byte {
	out := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
	out = append(out, kind...)
	out = append(out, data...)
	return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(append([]byte(kind), data...)))
}

func TestStripPhotoMetadata_PNG(t *testing.T) {
	encoded := testutil.PNG(t, 8, 8)
	// After the signature and IHDR (8 + 25 bytes), the text chunks of a camera or
	// an editor; and something after the end.
	var original bytes.Buffer
	original.Write(encoded[:33])
	original.Write(chunk("eXIf", exifWithGPS()[6:]))
	original.Write(chunk("tEXt", []byte("Comment\x00"+gpsDay)))
	original.Write(chunk("iTXt", []byte("XML:com.adobe.xmp\x00\x00\x00\x00\x00GPS "+gpsDay)))
	original.Write(chunk("zTXt", []byte("Raw profile\x00\x00x")))
	original.Write(encoded[33:])
	original.WriteString("après la fin " + gpsDay)

	stripped, err := mcp.StripPhotoMetadata("image/png", original.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{gpsDay, "eXIf", "tEXt", "iTXt", "zTXt"} {
		if bytes.Contains(stripped, []byte(gone)) {
			t.Errorf("the photo sent still holds %q", gone)
		}
	}
	if !bytes.Equal(stripped, encoded) {
		t.Error("the photo sent is not the image without its text chunks")
	}
	samePixels(t, func(b []byte) (image.Image, error) { return png.Decode(bytes.NewReader(b)) }, original.Bytes(), stripped)
}

// webpChunk is a RIFF chunk of a WebP: its FourCC, its size, its data, padded to an
// even size.
func webpChunk(fourCC string, data []byte) []byte {
	out := append([]byte(fourCC), binary.LittleEndian.AppendUint32(nil, uint32(len(data)))...)
	out = append(out, data...)
	if len(data)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

func webpOf(chunks ...[]byte) []byte {
	body := []byte("WEBP")
	for _, c := range chunks {
		body = append(body, c...)
	}
	return append(append([]byte("RIFF"), binary.LittleEndian.AppendUint32(nil, uint32(len(body)))...), body...)
}

func TestStripPhotoMetadata_WebP(t *testing.T) {
	// VP8X with the flags ICC (0x20), EXIF (0x08) and XMP (0x04), and a 16×8 canvas.
	vp8x := func(flags byte) []byte { return webpChunk("VP8X", []byte{flags, 0, 0, 0, 15, 0, 0, 7, 0, 0}) }
	icc := webpChunk("ICCP", []byte("profile"))
	bitstream := webpChunk("VP8L", []byte{0x2f, 1, 2, 3, 4})
	original := webpOf(vp8x(0x2c), icc, bitstream, webpChunk("EXIF", exifWithGPS()[6:]), webpChunk("XMP ", []byte("<x:xmpmeta>"+gpsDay+"</x:xmpmeta>")))

	stripped, err := mcp.StripPhotoMetadata("image/webp", original)
	if err != nil {
		t.Fatal(err)
	}
	if want := webpOf(vp8x(0x20), icc, bitstream); !bytes.Equal(stripped, want) {
		t.Errorf("the photo sent is\n%q\nwant\n%q", stripped, want)
	}
}

func TestStripPhotoMetadata_ABrokenFileIsRefused(t *testing.T) {
	photo := jpegWithGPS(t)
	encoded := testutil.PNG(t, 8, 8)
	for _, row := range []struct {
		name, contentType string
		data              []byte
	}{
		{"a JPEG cut in a segment", "image/jpeg", photo[:40]},
		{"a JPEG cut in its image", "image/jpeg", photo[:len(photo)/2]},
		{"a JPEG without its start", "image/jpeg", photo[2:]},
		{"a PNG cut in a chunk", "image/png", encoded[:40]},
		{"a PNG without its end", "image/png", encoded[:len(encoded)-12]},
		{"a WebP whose chunk goes past its end", "image/webp", webpOf([]byte("VP8L\xff\x00\x00\x00abc"))},
		{"a GIF", "image/gif", []byte("GIF89a")},
	} {
		t.Run(row.name, func(t *testing.T) {
			if _, err := mcp.StripPhotoMetadata(row.contentType, row.data); err == nil {
				t.Error("read as a photo")
			}
		})
	}
}
