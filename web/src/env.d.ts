/// <reference types="vite/client" />

/** The depth of the skins in this build (`VITE_SKIN_DEPTH`), set by src/skins/plugin.ts. */
declare const BUILD_SKIN_DEPTH: "palette" | "mix" | "full";

/** The stylesheets and the variants of the skins at the depth of the build: one of src/skins/depth/. */
declare module "virtual:skin-depth" {
  /** The components that the skins replace at this depth, by the path of their file (`../<id>/mix.tsx`). */
  export const variants: Readonly<
    // A variant takes the props of the component it replaces (see `Variants` in src/skins/types.ts).
    // oxlint-disable-next-line typescript/no-explicit-any
    Record<string, Readonly<Record<string, import("react").ComponentType<any>>>>
  >;
}
