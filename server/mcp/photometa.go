package mcp

import (
	"bytes"
	"encoding/binary"
	"errors"
)

// The metadata of a photo (spec § 6.9). The site resizes a photo in the browser
// (toAvatarBlob, a canvas), which drops all its metadata; the tool sends the file
// without re-encoding it, so it takes them out itself: where the photo was taken
// (the GPS of Exif), the camera, the dates, the comments, the editor's notes. The
// image itself is not touched: its bytes are copied, segment by segment, or chunk
// by chunk. The orientation of a JPEG stays (in an Exif of its own), so that the
// photo is shown the right way up.

// errUnreadablePhoto is a photo whose structure the tool cannot follow: it is
// not sent, since its metadata could not be taken out.
var errUnreadablePhoto = errors.New("mcp: a photo whose structure cannot be read")

// unreadablePhoto is what a call with such a photo is told.
const unreadablePhoto = "Cette photo n'a pas pu être lue (le fichier est peut-être abîmé) : envoie-la à nouveau, ou une autre."

// stripPhotoMetadata is a photo of that type (photoTypes) without its metadata.
func stripPhotoMetadata(contentType string, data []byte) ([]byte, error) {
	switch contentType {
	case "image/jpeg":
		return stripJPEG(data)
	case "image/png":
		return stripPNG(data)
	case "image/webp":
		return stripWebP(data)
	}
	return nil, errUnreadablePhoto
}

// ---------------------------------------------------------------------------
// JPEG

// stripJPEG keeps, of the segments before the image, those that the decoding
// needs: JFIF (APP0), the ICC profile (APP2 « ICC_PROFILE »), Adobe's colour
// transform (APP14 « Adobe »), and the tables and frames. It drops every other
// APP segment (Exif and XMP in APP1, the pictures of MPF in APP2, IPTC in APP13,
// the makers' own) and the comments, and whatever follows the end of the image
// (the second pictures of a phone). The orientation of the Exif, when it is not
// the upright one, goes in an Exif of its own, with nothing else.
func stripJPEG(data []byte) ([]byte, error) {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return nil, errUnreadablePhoto
	}
	out := make([]byte, 0, len(data))
	out = append(out, 0xFF, 0xD8)
	orientation, placed := 0, false
	for i := 2; ; {
		// A marker: 0xFF, the fill bytes that may follow it, and its code.
		if i >= len(data) || data[i] != 0xFF {
			return nil, errUnreadablePhoto
		}
		for i < len(data) && data[i] == 0xFF {
			i++
		}
		if i >= len(data) {
			return nil, errUnreadablePhoto
		}
		marker := data[i]
		i++
		switch {
		case marker == 0xD9: // the end of the image: nothing after it is kept
			return append(out, 0xFF, 0xD9), nil
		case marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7): // no length
			out = append(out, 0xFF, marker)
			continue
		}
		if i+2 > len(data) {
			return nil, errUnreadablePhoto
		}
		length := int(binary.BigEndian.Uint16(data[i:]))
		if length < 2 || i+length > len(data) {
			return nil, errUnreadablePhoto
		}
		payload := data[i+2 : i+length]
		segment := data[i : i+length]
		i += length

		if marker == 0xE1 && bytes.HasPrefix(payload, []byte("Exif\x00\x00")) {
			if o := exifOrientation(payload[6:]); o > 1 {
				orientation = o
			}
		}
		if !keptSegment(marker, payload) {
			continue
		}
		// The orientation goes right after JFIF, before what draws the image.
		if !placed && marker != 0xE0 {
			placed = true
			if orientation > 1 {
				out = append(out, orientationSegment(orientation)...)
			}
		}
		out = append(out, 0xFF, marker)
		out = append(out, segment...)

		if marker == 0xDA {
			// A scan: its coded data go to the next marker, which is neither a
			// stuffed 0xFF (0xFF00) nor a restart (0xFFD0 to 0xFFD7).
			start := i
			for {
				if i+1 >= len(data) {
					return nil, errUnreadablePhoto
				}
				if data[i] == 0xFF && data[i+1] != 0x00 && (data[i+1] < 0xD0 || data[i+1] > 0xD7) {
					break
				}
				i++
			}
			out = append(out, data[start:i]...)
		}
	}
}

// keptSegment reports whether a segment of a JPEG is one that the decoding needs:
// every segment that is not an APP segment or a comment, and of those, JFIF, the
// ICC profile and Adobe's.
func keptSegment(marker byte, payload []byte) bool {
	switch {
	case marker == 0xFE: // a comment
		return false
	case marker == 0xE0:
		return true
	case marker == 0xE2:
		return bytes.HasPrefix(payload, []byte("ICC_PROFILE\x00"))
	case marker == 0xEE:
		return bytes.HasPrefix(payload, []byte("Adobe"))
	case marker >= 0xE1 && marker <= 0xEF:
		return false
	}
	return true
}

// exifOrientation is the orientation (tag 0x0112 of IFD0) of a TIFF structure, 0
// when it has none that can be read.
func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 0
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	ifd := int(order.Uint32(tiff[4:]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 0
	}
	entries := int(order.Uint16(tiff[ifd:]))
	for e := range entries {
		at := ifd + 2 + 12*e
		if at+12 > len(tiff) {
			return 0
		}
		if order.Uint16(tiff[at:]) == 0x0112 && order.Uint16(tiff[at+2:]) == 3 {
			if o := int(order.Uint16(tiff[at+8:])); o >= 1 && o <= 8 {
				return o
			}
			return 0
		}
	}
	return 0
}

// orientationSegment is an APP1 segment whose Exif holds the orientation, and
// nothing else.
func orientationSegment(orientation int) []byte {
	exif := []byte("Exif\x00\x00MM\x00\x2a\x00\x00\x00\x08")
	exif = append(exif, 0, 1)                         // one entry
	exif = append(exif, 0x01, 0x12, 0, 3, 0, 0, 0, 1) // the orientation: one SHORT
	exif = append(exif, 0, byte(orientation), 0, 0)   // its value
	exif = append(exif, 0, 0, 0, 0)                   // no other directory
	out := []byte{0xFF, 0xE1, 0, byte(len(exif) + 2)}
	return append(out, exif...)
}

// ---------------------------------------------------------------------------
// PNG

// pngSignature is the start of every PNG file.
var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// droppedChunks are the chunks of a PNG that are metadata: Exif and the texts
// (which hold XMP, comments and the editor's notes).
var droppedChunks = map[string]bool{"eXIf": true, "tEXt": true, "iTXt": true, "zTXt": true}

// stripPNG keeps every chunk of a PNG but its metadata, up to its end (IEND):
// what follows it is dropped. The chunks kept are copied as they are, with their
// CRC.
func stripPNG(data []byte) ([]byte, error) {
	if !bytes.HasPrefix(data, pngSignature) {
		return nil, errUnreadablePhoto
	}
	out := append(make([]byte, 0, len(data)), pngSignature...)
	for i := len(pngSignature); ; {
		if i+8 > len(data) {
			return nil, errUnreadablePhoto
		}
		length := int(binary.BigEndian.Uint32(data[i:]))
		kind := string(data[i+4 : i+8])
		end := i + 12 + length
		if length < 0 || end > len(data) || end < i {
			return nil, errUnreadablePhoto
		}
		if !droppedChunks[kind] {
			out = append(out, data[i:end]...)
		}
		if kind == "IEND" {
			return out, nil
		}
		i = end
	}
}

// ---------------------------------------------------------------------------
// WebP

// The flags of the VP8X chunk of a WebP that say that it has Exif or XMP.
const (
	webpExifFlag = 0x08
	webpXMPFlag  = 0x04
)

// stripWebP keeps every chunk of a WebP but its metadata (EXIF, XMP), clears the
// flags of the VP8X chunk that announced them, and writes the size of the RIFF
// again. What follows the RIFF is dropped.
func stripWebP(data []byte) ([]byte, error) {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return nil, errUnreadablePhoto
	}
	size := int(binary.LittleEndian.Uint32(data[4:]))
	if size < 4 || 8+size > len(data) {
		return nil, errUnreadablePhoto
	}
	riff := data[:8+size]
	out := append(make([]byte, 0, len(riff)), riff[:12]...)
	for i := 12; i < len(riff); {
		if i+8 > len(riff) {
			return nil, errUnreadablePhoto
		}
		fourCC := string(riff[i : i+4])
		length := int(binary.LittleEndian.Uint32(riff[i+4:]))
		end := i + 8 + length + length%2
		if length < 0 || end > len(riff) || end < i {
			return nil, errUnreadablePhoto
		}
		switch fourCC {
		case "EXIF", "XMP ":
		case "VP8X":
			chunk := append([]byte(nil), riff[i:end]...)
			if length > 0 {
				chunk[8] &^= webpExifFlag | webpXMPFlag
			}
			out = append(out, chunk...)
		default:
			out = append(out, riff[i:end]...)
		}
		i = end
	}
	binary.LittleEndian.PutUint32(out[4:], uint32(len(out)-8))
	return out, nil
}
