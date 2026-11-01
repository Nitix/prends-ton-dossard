// Command icons draws the icons of the web app and writes them as PNG files:
// the three of the manifest, and the one that an iPhone puts on its home
// screen. They are committed: the build does not run this program, which only
// has to be run again when the drawing changes.
//
//	go run ./tools/icons [-out web/public/icons]
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

// The colours. The background is the one of the main buttons of the app
// (neutral-900 of Tailwind, and the theme colour of the manifest).
var (
	backgroundColour = color.NRGBA{R: 0x17, G: 0x17, B: 0x17, A: 0xff}
	bibColour        = color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
	bandColour       = color.NRGBA{R: 0xf9, G: 0x73, B: 0x16, A: 0xff} // orange-500
	pinColour        = backgroundColour
)

// The drawing is made in a frame centred on the icon, 1 wide, the width of the
// bib. The vertical axis points down.
const (
	bibHalfWidth   = 0.5
	bibHalfHeight  = 0.35
	bibRadius      = 0.1
	bandHalfHeight = 0.09
	pinX           = 0.36
	pinY           = -0.235
	pinRadius      = 0.045
)

// How much of the icon the frame takes. The corners of the bib are its
// farthest points from the middle, 0.572 of the frame: a maskable icon is only
// sure to show the circle that is 80 % of its width, so it is drawn smaller.
const (
	frameSize         = 0.78
	frameSizeMaskable = 0.69
	samplesPerAxis    = 4 // the edges are smoothed by averaging this many by this many points
)

// icon is a file to write.
type icon struct {
	name     string
	size     int
	maskable bool
}

var icons = []icon{
	{"icon-192.png", 192, false},
	{"icon-512.png", 512, false},
	{"icon-maskable-512.png", 512, true},
	{"apple-touch-icon.png", 180, false},
}

func main() {
	out := flag.String("out", filepath.Join("web", "public", "icons"), "the directory the PNG files are written in")
	flag.Parse()
	if err := run(*out); err != nil {
		log.Fatal(err)
	}
}

// run writes the icons in dir, which it creates if need be.
func run(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, i := range icons {
		if err := write(filepath.Join(dir, i.name), draw(i.size, i.maskable)); err != nil {
			return fmt.Errorf("%s: %w", i.name, err)
		}
	}
	return nil
}

func write(path string, img image.Image) (err error) {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
	}()
	return (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(file, img)
}

// draw paints a race bib on the background: white, with a band across it and
// a pin at each of its top corners. A maskable icon keeps it in the circle
// that every mask shows.
func draw(size int, maskable bool) *image.NRGBA {
	frame := frameSize
	if maskable {
		frame = frameSizeMaskable
	}
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	n := samplesPerAxis * samplesPerAxis
	for y := range size {
		for x := range size {
			var r, g, b int
			for sy := range samplesPerAxis {
				for sx := range samplesPerAxis {
					u := ((float64(x)+(float64(sx)+0.5)/samplesPerAxis)/float64(size) - 0.5) / frame
					v := ((float64(y)+(float64(sy)+0.5)/samplesPerAxis)/float64(size) - 0.5) / frame
					c := colourAt(u, v)
					r, g, b = r+int(c.R), g+int(c.G), b+int(c.B)
				}
			}
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(r / n), G: uint8(g / n), B: uint8(b / n), A: 0xff})
		}
	}
	return img
}

// colourAt is the colour of the point (u, v) of the frame.
func colourAt(u, v float64) color.NRGBA {
	for _, side := range []float64{-1, 1} {
		if math.Hypot(u-side*pinX, v-pinY) <= pinRadius {
			return pinColour
		}
	}
	if !inRoundedRect(u, v, bibHalfWidth, bibHalfHeight, bibRadius) {
		return backgroundColour
	}
	if math.Abs(v) <= bandHalfHeight {
		return bandColour
	}
	return bibColour
}

// inRoundedRect reports whether (u, v) is in the rectangle centred on the
// origin, half as wide as halfWidth and as high as halfHeight, with its corners
// rounded to radius.
func inRoundedRect(u, v, halfWidth, halfHeight, radius float64) bool {
	dx := math.Max(math.Abs(u)-(halfWidth-radius), 0)
	dy := math.Max(math.Abs(v)-(halfHeight-radius), 0)
	return dx*dx+dy*dy <= radius*radius
}
