package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestRun_WritesTheFourIcons(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "icons") // it does not exist yet

	if err := run(dir); err != nil {
		t.Fatalf("run: %v", err)
	}

	want := map[string]int{
		"icon-192.png":          192,
		"icon-512.png":          512,
		"icon-maskable-512.png": 512,
		"apple-touch-icon.png":  180,
	}
	for name, size := range want {
		file, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		img, err := png.Decode(file)
		file.Close()
		if err != nil {
			t.Errorf("%s is not a PNG: %v", name, err)
			continue
		}
		if got := img.Bounds().Size(); got != (image.Point{X: size, Y: size}) {
			t.Errorf("%s is %v, want %dx%d", name, got, size, size)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != len(want) {
		t.Errorf("%d files written, want %d", len(entries), len(want))
	}
}

func TestDraw_IsOpaque(t *testing.T) {
	// The home screen of an iPhone paints a transparent icon on black.
	for _, maskable := range []bool{false, true} {
		img := draw(180, maskable)
		for y := range 180 {
			for x := range 180 {
				if _, _, _, a := img.At(x, y).RGBA(); a != 0xffff {
					t.Fatalf("maskable=%v: the pixel (%d, %d) is not opaque", maskable, x, y)
				}
			}
		}
	}
}

func TestDraw_ShowsTheBib(t *testing.T) {
	img := draw(512, false)

	at := func(u, v float64) color.NRGBA {
		return img.NRGBAAt(int((0.5+u)*512), int((0.5+v)*512))
	}
	if got := at(0, 0); got != bandColour {
		t.Errorf("the middle of the icon is %v, want the band %v", got, bandColour)
	}
	if got := at(0, -0.2); got != bibColour {
		t.Errorf("above the band is %v, want the bib %v", got, bibColour)
	}
	if got := at(-0.48, -0.48); got != backgroundColour {
		t.Errorf("a corner is %v, want the background %v", got, backgroundColour)
	}
}

func TestDraw_MaskableStaysInTheSafeZone(t *testing.T) {
	// Android cuts a maskable icon to a shape of its choice: only the circle
	// that is 80 % wide, at the middle, is sure to be seen.
	const size = 512
	img := draw(size, true)

	for y := range size {
		for x := range size {
			dx, dy := float64(x)+0.5-size/2, float64(y)+0.5-size/2
			if math.Hypot(dx, dy) <= 0.4*size {
				continue
			}
			if got := img.NRGBAAt(x, y); got != backgroundColour {
				t.Fatalf("the pixel (%d, %d) is %v, outside the safe zone: want the background", x, y, got)
			}
		}
	}
}
