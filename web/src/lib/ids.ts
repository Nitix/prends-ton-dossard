// Ids chosen by the client. PocketBase accepts the id of a new record when it
// has the format of its own ids: 15 lowercase letters and digits. Choosing it
// here lets one batch create an event and the records that point to it.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 15;
/** The biggest multiple of 36 that fits in a byte: a byte from there up is drawn again, which keeps every character equally likely. */
const UNBIASED_LIMIT = 252;

export function newId(): string {
  let id = "";
  while (id.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(LENGTH))) {
      if (byte < UNBIASED_LIMIT && id.length < LENGTH) id += ALPHABET[byte % ALPHABET.length];
    }
  }
  return id;
}
