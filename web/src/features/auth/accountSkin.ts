import { pb } from "../../lib/pb";
import type { UserRecord } from "../../lib/types";
import { DEFAULT_SKIN, SKINS, chooseSkin, readSkin, type Choice } from "../../skins";

/**
 * The skin follows the account. It is kept on the device, as it always was (it
 * must be there before anybody signs in, and after they sign out: the pages to
 * sign in are drawn in it), and on the account, so that it follows the person to
 * every device.
 *
 * The light or dark mode (lib/theme.ts) is not part of this: it stays the
 * device's own, since it follows the phone's setting.
 *
 * - **Choosing** in the settings (`chooseSkinOnAccount`): once the skin is on
 *   the page and on the device, the account is told.
 * - **Signing in, restoring a session** (`syncAccountSkin`, called by
 *   session.ts): the skin of the account is the device's, if this build has it.
 *   An account that has none gets the device's, unless it is Crête (which is
 *   what nobody having chosen means). A skin that this build does not have
 *   (a later build's, or one that was removed) is Crête on the device, and the
 *   account keeps it: a build that has it will show it.
 * - **Offline**: a choice whose save fails stays on the device, and the device
 *   remembers that the account was not told (`UNSAVED_KEY`, with the id of the
 *   account). The next `syncAccountSkin` for that account, a sign-in or a
 *   session restored, sends the device's skin instead of reading the account's.
 *   Nothing else retries, and the choice shows no error: it is on the device.
 */

/**
 * Where the device keeps the id of the account whose skin was not saved (the
 * save failed). index.html does not read it.
 */
export const UNSAVED_KEY = "ptd-skin-unsaved";

function unsavedFor(): string | null {
  try {
    return localStorage.getItem(UNSAVED_KEY);
  } catch {
    return null;
  }
}

function markUnsaved(userId: string): void {
  try {
    localStorage.setItem(UNSAVED_KEY, userId);
  } catch {
    // The page has the skin; the account will have it next time it is chosen.
  }
}

function forgetUnsaved(): void {
  try {
    localStorage.removeItem(UNSAVED_KEY);
  } catch {
    // Nothing to forget in a storage that refuses.
  }
}

/** The saves on their way: they go one after the other, so that the last choice is the one the account keeps. */
let saving: Promise<void> = Promise.resolve();

/** How many saves are on their way: the device forgets that the account is behind when the last one is done. */
let inFlight = 0;

/** Settles when the saves on their way have, successfully or not (for a test, or whoever needs the account to be told). */
export const whenSaved = (): Promise<void> => saving;

/**
 * Tells the account the skin chosen. The device marks the account as not told
 * before the update leaves, and forgets it when the last one has succeeded: an
 * update that never ends, because the app was killed (an iPhone's, swiped
 * away), leaves the mark, and the next start sends the device's skin instead of
 * reading the account's older one. A failure (offline, the server's refusal) is
 * not thrown: the device keeps the choice, and the mark.
 */
function save(userId: string, skin: string): Promise<void> {
  markUnsaved(userId);
  inFlight++;
  const previous = saving;
  saving = (async () => {
    // It never rejects: the previous save has caught its own failure.
    await previous;
    try {
      await pb.collection("users").update(userId, { skin });
      inFlight--;
      // Not while a later choice is still on its way: it is what the account lacks.
      if (inFlight === 0) forgetUnsaved();
    } catch {
      inFlight--;
    }
  })();
  return saving;
}

/**
 * Chooses a skin as the settings do: on the page and on the device (see
 * `chooseSkin`), then, when that worked and somebody is signed in (`userId`,
 * empty when nobody is), on their account. It says what came of the choice, and
 * settles once the account has been told, or has failed to be. A skin whose
 * look cannot be loaded (`failed`) is neither on the device nor on the account.
 */
export async function chooseSkinOnAccount(id: string, userId: string): Promise<Choice> {
  const choice = await chooseSkin(id);
  if (choice === "chosen" && userId !== "") {
    // Crête is saved under its own name: for an account that has none, another
    // device that kept a skin would put it back.
    await save(userId, SKINS.some((skin) => skin.id === id) ? id : DEFAULT_SKIN);
  }
  return choice;
}

/**
 * Puts the skin of the account and the device's in agreement, when somebody
 * signs in or the app restores their session. It never throws.
 *
 * It settles once the skin is on the page (the app is first drawn in it: no
 * flash), and does not wait for a save: what the account lacks is sent in the
 * background (the chain of saves keeps the order, `whenSaved` says when it is
 * done). A slow update, or one that the server drops (the demo's account keeps
 * no skin), must not hold the app back at every cold start.
 */
export async function syncAccountSkin(user: UserRecord): Promise<void> {
  const unsaved = unsavedFor();
  if (unsaved === user.id) {
    // A choice made here that the account never got: it is the person's last one.
    void save(user.id, readSkin());
    return;
  }
  // The choice of somebody else that the device kept, which is not this one's to send.
  if (unsaved !== null) forgetUnsaved();

  const account = user.skin ?? "";
  if (account === "") {
    const device = readSkin();
    if (device !== DEFAULT_SKIN) void save(user.id, device);
    return;
  }
  // The skin of the account, put on the page and kept on the device. One that
  // this build does not know is Crête (see `chooseSkin`), and the account is left alone.
  await chooseSkin(account);
}
