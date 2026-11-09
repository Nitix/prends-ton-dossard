import { afterEach, expect, test, vi } from "vitest";
import { server } from "vitest/browser";

import { imageFile, sizeOf } from "../test/images";
import { ImageDecodeError, toAvatarBlob } from "./resizeImage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("toAvatarBlob — une image de 2000×1000 devient un WebP de 512×256", async () => {
  const blob = await toAvatarBlob(await imageFile(2000, 1000));

  expect(blob.type).toBe("image/webp");
  expect(await sizeOf(blob)).toEqual({ width: 512, height: 256 });
});

test("toAvatarBlob — une photo plus petite n'est jamais agrandie", async () => {
  const blob = await toAvatarBlob(await imageFile(300, 200));

  expect(await sizeOf(blob)).toEqual({ width: 300, height: 200 });
});

test("toAvatarBlob — la taille maximale se choisit", async () => {
  const blob = await toAvatarBlob(await imageFile(2000, 1000), 128);

  expect(await sizeOf(blob)).toEqual({ width: 128, height: 64 });
});

test("toAvatarBlob — sans OffscreenCanvas (Safari ancien), passe par <canvas> et donne le même résultat", async () => {
  const file = await imageFile(2000, 1000);
  vi.stubGlobal("OffscreenCanvas", undefined);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");

  const blob = await toAvatarBlob(file);

  expect(toBlob).toHaveBeenCalledOnce();
  expect(toBlob.mock.calls[0]?.slice(1)).toEqual(["image/webp", 0.85]);
  expect(blob.type).toBe("image/webp");
  expect(await sizeOf(blob)).toEqual({ width: 512, height: 256 });
});

/**
 * An encoder that does not know WebP: the first encoding answers with a PNG,
 * whatever it is asked, as the browsers that lack the encoder do. The next
 * ones are the real thing. The PNG is asked of the real encoder, since the
 * stand-in of one call is gone by the time it runs: the spy sees that request
 * too, between the one for WebP and the one for JPEG.
 */
function encoderWithoutWebP() {
  return vi.spyOn(OffscreenCanvas.prototype, "convertToBlob").mockImplementationOnce(function (
    this: OffscreenCanvas,
  ) {
    return this.convertToBlob({ type: "image/png" });
  });
}

// Playwright's WebKit on Windows has no OffscreenCanvas: there is no encoder to fake.
const hasOffscreenCanvas = typeof OffscreenCanvas !== "undefined";

test.skipIf(!hasOffscreenCanvas)(
  "toAvatarBlob — si l'encodeur ne sait pas faire de WebP, réencode en JPEG",
  async () => {
    const file = await imageFile(2000, 1000);
    const convert = encoderWithoutWebP();

    const blob = await toAvatarBlob(file);

    expect(convert.mock.calls.map(([options]) => options)).toEqual([
      { type: "image/webp", quality: 0.85 },
      { type: "image/png" },
      { type: "image/jpeg", quality: 0.85 },
    ]);
    expect(blob.type).toBe("image/jpeg");
    expect(await sizeOf(blob)).toEqual({ width: 512, height: 256 });
  },
);

test.skipIf(!hasOffscreenCanvas)(
  "toAvatarBlob — le repli JPEG, qui n'a pas de transparence, met du blanc dessous",
  async () => {
    const file = await imageFile(64, 64, { transparent: true });
    encoderWithoutWebP();

    const blob = await toAvatarBlob(file);

    expect(blob.type).toBe("image/jpeg");
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    context?.drawImage(bitmap, 32, 32, 1, 1, 0, 0, 1, 1);
    bitmap.close();
    const [red = 0, green = 0, blue = 0, alpha = 0] = context?.getImageData(0, 0, 1, 1).data ?? [];
    expect([red, green, blue, alpha].every((channel) => channel >= 250)).toBe(true);
  },
);

/** The bytes of a JPEG with an EXIF segment right after its start: the orientation, 1 to 8. */
async function withOrientation(jpeg: Blob, orientation: number): Promise<Blob> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const exif = Uint8Array.of(
    // APP1, 34 bytes with this length
    0xff,
    0xe1,
    0x00,
    0x22,
    // "Exif\0\0"
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    // The TIFF header, big-endian, then one entry
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    // The orientation: tag, type (short), count, value
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    // No other directory
    0x00,
    0x00,
    0x00,
    0x00,
  );
  return new Blob([bytes.slice(0, 2), exif, bytes.slice(2)], { type: "image/jpeg" });
}

// Firefox refuses to decode the JPEG with the hand-made EXIF segment of this test (the other
// browsers read it); a photo from a camera has a whole one. To be checked with such a photo.
test.skipIf(server.browser === "firefox")(
  "toAvatarBlob — la photo tournée par son EXIF est redressée",
  async () => {
    // 400 × 200 as stored, to turn a quarter turn to the right: 200 × 400 to the eye.
    const stored = await imageFile(400, 200, { type: "image/jpeg", name: "photo.jpg" });
    const file = await withOrientation(stored, 6);
    expect(await sizeOf(stored)).toEqual({ width: 400, height: 200 });

    const blob = await toAvatarBlob(file);

    expect(await sizeOf(blob)).toEqual({ width: 200, height: 400 });
  },
);

test("toAvatarBlob — un fichier illisible lève ImageDecodeError", async () => {
  const heic = new Blob(["ceci n'est pas une image"], { type: "image/heic" });

  await expect(toAvatarBlob(heic)).rejects.toBeInstanceOf(ImageDecodeError);
});
