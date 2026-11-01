import { pb } from "./pb";
import type { RunnerRecord } from "./types";

/** The two thumbs the server makes of a photo (the field `avatar` of `runners`): the pastilles and lists, and the profile. */
export type AvatarThumb = "96x96" | "256x256";

/**
 * Where to find the photo of a runner, in this size. It has none for a runner
 * without a photo (the SDK is not even asked): the screens show the initials.
 */
export function avatarURL(runner: RunnerRecord, thumb: AvatarThumb): string | undefined {
  if (!runner.avatar) return undefined;
  return pb.files.getURL(runner, runner.avatar, { thumb });
}

/**
 * Sets the photo of a runner: the file goes to the server as a form, which
 * replaces the previous photo. The name of the file only says its type.
 */
export function uploadAvatar(runnerId: string, image: Blob): Promise<RunnerRecord> {
  const body = new FormData();
  body.append("avatar", image, image.type === "image/jpeg" ? "avatar.jpg" : "avatar.webp");
  return pb.collection("runners").update<RunnerRecord>(runnerId, body);
}

/** Takes the photo of a runner away. */
export function removeAvatar(runnerId: string): Promise<RunnerRecord> {
  return pb.collection("runners").update<RunnerRecord>(runnerId, { avatar: null });
}
