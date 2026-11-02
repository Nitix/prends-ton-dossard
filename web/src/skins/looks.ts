import type { Look } from "./types";

// The looks of the skins: for each skin but Crête, its `look.ts`, loaded when it
// is chosen (see index.ts and README.md), a part of the build of its own with
// its stylesheets. The skins of development (`_` folders) are in the dev server
// and the tests only: a build has nothing of them.

/** How to load the look of each skin, by the path of its file (`./<id>/look.ts`). */
export const LOOKS: Readonly<Record<string, () => Promise<Look>>> = {
  ...import.meta.glob<Look>(["./*/look.ts", "!./_*/look.ts"]),
  ...(import.meta.env.DEV ? import.meta.glob<Look>("./_*/look.ts") : {}),
};
