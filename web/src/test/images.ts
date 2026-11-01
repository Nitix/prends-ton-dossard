// Pictures for the tests that run in the browser (the `*.test.tsx` ones).

type Options = {
  name?: string;
  /** The MIME type to encode, "image/png" unless said. */
  type?: "image/png" | "image/jpeg";
  /** Leaves the picture clear, instead of a gradient. */
  transparent?: boolean;
};

function drawn(width: number, height: number, transparent: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas in this browser");
  if (!transparent) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#e11d48");
    gradient.addColorStop(1, "#2563eb");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`this browser cannot encode ${type}`));
    }, type);
  });
}

/** The file a user picks: a picture of this size, drawn on a canvas. */
export async function imageFile(
  width: number,
  height: number,
  { name = "photo.png", type = "image/png", transparent = false }: Options = {},
): Promise<File> {
  const blob = await encode(drawn(width, height, transparent), type);
  return new File([blob], name, { type });
}

/**
 * A picture the browser loads at once, as a data URL: the address an `<img>`
 * can have in a test without a request that would fail and show the initials.
 */
export function pixelURL(): string {
  return drawn(2, 2, false).toDataURL("image/png");
}

/** The size the browser reads in a picture. */
export async function sizeOf(image: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(image);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
