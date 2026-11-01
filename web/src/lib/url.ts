/**
 * The address, if it is a web address, or null: the field is free text for
 * whoever writes the event (or a ride, or a lodging), and `javascript:` is
 * one. Only `http:` and `https:` pass, and the text is returned as it was
 * written.
 */
export function webAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:" || protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}
