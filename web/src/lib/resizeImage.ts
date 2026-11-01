/** The longest side of a photo of a runner, in pixels: the biggest thumb the site asks for is 256, shown on screens up to twice as dense. */
export const AVATAR_MAX_PX = 512;

/** The quality of the WebP and of the JPEG: a photo that size has no visible loss at 0.85. */
const QUALITY = 0.85;

/**
 * The size of a picture that must fit in a square of `max` pixels: it keeps its
 * proportions, is never enlarged, and has at least a pixel on each side.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The browser could not read the picture: a format it does not know (HEIC, outside Safari), or not a picture at all. */
export class ImageDecodeError extends Error {}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Draws the bitmap on a canvas of this size and encodes it. It draws on an
 * `OffscreenCanvas` and, in a browser that has none (Safari before 16.4), on a
 * `<canvas>`; the result is the same. An encoder that does not know the type
 * answers with a PNG instead, which is for the caller to check.
 *
 * A JPEG has no transparency: the picture is drawn on white, or the clear
 * parts of a PNG would come out black.
 */
async function encode(
  bitmap: ImageBitmap,
  { width, height }: { width: number; height: number },
  type: "image/webp" | "image/jpeg",
): Promise<Blob> {
  const paint = (context: Context | null) => {
    if (!context) throw new Error("this browser has no 2D canvas");
    if (type === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
  };

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    paint(canvas.getContext("2d"));
    return canvas.convertToBlob({ type, quality: QUALITY });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d"));
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("this browser could not encode the canvas"));
      },
      type,
      QUALITY,
    );
  });
}

/**
 * The photo to send for a file the user picked: the picture, turned upright
 * by its EXIF orientation, at most `max` pixels on its longest side, as a
 * WebP. A phone photo of several megabytes becomes a few tens of kilobytes,
 * and what the server accepts (5 MB) is never the limit.
 *
 * A browser whose encoder does not know WebP gives a PNG, which is no smaller
 * than the photo: it is encoded again as a JPEG.
 *
 * @throws {ImageDecodeError} when the browser cannot read the file.
 */
export async function toAvatarBlob(file: Blob, max: number = AVATAR_MAX_PX): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (cause) {
    throw new ImageDecodeError("the browser cannot decode this image", { cause });
  }

  try {
    const size = fitWithin(bitmap.width, bitmap.height, max);
    const webp = await encode(bitmap, size, "image/webp");
    return webp.type === "image/webp" ? webp : await encode(bitmap, size, "image/jpeg");
  } finally {
    bitmap.close();
  }
}
