# Skins

A skin dresses the app; it never changes what the app does. It sets the
colours, the fonts and the motifs of the app on Crête's markup, which is the
same in every skin. Each one is a folder of this one, found by
`import.meta.glob("./*/index.ts")` in `index.ts`: adding a skin is adding a
folder, and its name to the list of `styles.css` (see Utilities). « Crête »
(`crete/`) is the default: `styles.css` draws it, and a page without
`data-skin` on `<html>` is in it.

The skin is chosen in Réglages → Apparence → « Thème », kept on the device
(`localStorage["ptd-skin"]`, nothing for Crête; signing out leaves it) and put
on `<html data-skin="<id>">`, with its mode and the colour of the browser's bar,
by the script of `index.html` before the page is first drawn, then by
`applySkin`. Each skin but Crête is loaded when it is chosen (see Loading on
demand): a person who stays on Crête loads nothing of the others.

The skin follows the account (`features/auth/accountSkin.ts`): chosen while
signed in, it is kept on the account too (`users.skin`, a text of at most 32
characters that the server does not interpret), so that it follows the person to
their other devices. The device's copy stays what the page reads before anybody
signs in, and after they sign out. The light or dark mode (`lib/theme.ts`) is
not part of it: it stays the device's own.

- **Signing in, restoring a session** (`syncAccountSkin`, from `session.ts`:
  `restoreSession` when the app starts, the auth store's change for a sign-in,
  whichever way): the skin of the account, if this build has it, is put on the
  page and kept on the device. An account that has none gets the device's skin,
  unless it is Crête's (nobody having chosen is Crête). A skin that this build
  does not have is Crête on the device, and the account is left alone. A
  renewal of the session that is already open does not do this: it would undo a
  choice that is on its way.
- **Offline**: a choice whose save fails stays on the device, which remembers
  that the account was not told (`localStorage["ptd-skin-unsaved"]`, the id of
  the account). The next sign-in or restored session of that account sends the
  device's skin to it, instead of reading the account's. Nothing else retries,
  and the choice shows no error.
- **Signing out** leaves the skin on the device and on the page.
- A skin whose look cannot be loaded when it is chosen (offline, never chosen
  on this device) gives a message (« Ce thème n'a pas pu se charger : vérifie ta
  connexion. »), and the page, the device and the account keep the skin they had
  (see Loading on demand: the page is not reloaded for it).
- On a demo instance (`DEMO_LOGIN_EMAIL`), every visitor is the same account:
  the server keeps no skin on it (`server/demo`; an update of its `skin` is
  dropped without an error), so each visitor keeps their device's.

## The folder of a skin

```
skins/<id>/
  index.ts       the skin (required): `export const skin: Skin`, in the entry of the app
  look.ts        its look (required but for Crête), loaded when it is chosen:
                 `export const slots: Partial<Slots>`, and `import` of its sheets
  fonts.css      its @font-face rules and `--font-*`
  palette.css    its custom properties: colours, radii, colours of shadows, paints of the dawn,
                 of the map and of Crête's motifs
  utilities.css  the utilities of Tailwind that its motifs use (see Utilities)
  motion.css     optional: what moves in its motifs (see Motion)
  *.tsx          its motifs, for the slots
```

`index.ts` (see `types.ts`) says only what the registry and the picker read,
and imports nothing but types: it is in the entry of the app, for everyone.

```ts
export const skin: Skin = {
  id: "<id>", // the name of the folder
  label: { fr: "…", en: "…" }, // its name in the picker
  modes: ["light"], // ["light"], ["dark"] or ["light", "dark"]
  swatches: ["#rrggbb", "#rrggbb"], // two colours on its card
  fontSample: '"Its Font", serif', // the font-family of its titles, for the sample on its card
  themeColor: "#rrggbb", // the browser's bar (<meta name="theme-color">): the top of its header
  animatedBackground: true, // only for a skin whose motifs move (see Motion): the settings offer « Animer le fond »
};
```

`modes` and `themeColor` are read by the build too (`plugin.ts`, for the script
of `index.html`): keep them literal.

`look.ts` is everything else, in a part of the build of its own:

```ts
import "./fonts.css";
import "./palette.css";
import "./utilities.css";
import type { Slots } from "../types";
import { BrandMark, HeaderArt } from "./motifs";

export const slots: Partial<Slots> = { HeaderArt, BrandMark }; // the motifs it draws (Crête's stand in for the others)
```

Crête has no look: its colours and fonts are `styles.css`'s, and its motifs
(`crete/index.ts`, `slots`) are in the entry, where they stand in for those a
skin does not draw.

A folder whose name starts with `_` is a skin of development (`_example/`): the
dev server and the tests have it, in the picker too; a build has nothing of it
(`plugin.ts` makes each of its files an empty module exporting `skin`,
`looks.ts` leaves its look out, the registry leaves it out, the table of
`index.html` does not name it, and `styles.css` does not scan its folder for
classes: it styles its few pieces inline).

## Loading on demand

What every page loads, for every person: the stylesheet of the entry
(`styles.css`, Crête's, with `theme.css`), and in the entry's script the
registry (each skin's `index.ts`), Crête's motifs and the picker's logic
(`index.ts` of this folder). Nothing of another skin: `build.test.ts` builds the
real app and checks it.

Each other skin is its look: `looks.ts` has a loader for each `<id>/look.ts`
(a `import.meta.glob` that is not eager), so the build makes each one a part of
its own, with a sheet of its own (its `fonts.css`, `palette.css` and
`utilities.css`, and the sheets of `shared/` it imports, in a sheet that the
looks which share them share).

- **Choosing** (`chooseSkin`, the picker, another tab): the look is loaded, then
  the choice is kept and applied. Vite adds the look's sheets to the page and
  waits for them, so the page is never in a skin without its colours. Two
  choices in a row: the last one wins, whichever loads first. A look that
  cannot be loaded (offline, never loaded before) leaves the page and the
  device as they were, and `chooseSkin` says so (`failed`), for the picker to
  tell the person. The page is **not reloaded** for it: the look goes through
  Vite's preload helper, which fires `vite:preloadError` when an import fails,
  and `reloadOnStaleChunks` (`lib/staleChunks.ts`, `main.tsx`) reloads the
  page for a route chunk that is gone after a deploy; it is told to leave a
  failure alone while a look is loading (`isLoadingLook`), and while the
  browser is offline (it also tells TanStack Router, which reloads once by
  itself for a route component it cannot import, that it has). The picker says
  « Chargement du thème… » to a screen reader while it waits (a polite status),
  and the focus stays on the skins when « Clair ou sombre » gives way to a
  sentence.
- **All or nothing** (`sheets.ts`, `loadSkin`): a look is its code and its
  sheets, and a page with the code and not the sheets is neither Crête nor the
  skin. Vite's helper takes a failed sheet for done and never asks for it again
  (nor does it see that a link written by `index.html` failed), so after the
  code is loaded `loadSkin` checks that the palette is in the page, asks again
  for the sheets that are missing (a link with no rule: Chromium gives a failed
  link an empty sheet), and rejects if it is still not there. A choice that
  failed so is tried again, sheets included, the next time. A sheet asked for
  again lands after `styles.css`, whatever its place was: the sheets of a look
  do not depend on that order (below), which is also why this and the order of
  `lookFiles` need nothing of each other.
- **At start** (`showKeptSkin`, `main.tsx`): the skin kept is applied at once
  (its mode, the colour of the bar), and its look loaded before the app is
  first drawn, so its motifs are there from the first render. A skin kept that
  is no longer in the app (a skin removed since), or whose look cannot be
  loaded (its code, or a sheet that stays missing: all or nothing, above), is
  Crête for this page, with no error; the device keeps the choice, and a sheet
  that failed once is asked for again before that.
- **Before the first paint**: the build writes into `index.html` the table of
  the skins (`plugin.ts`), in the order of their names: for each, its modes,
  its colour and the files of its look, from the bundle (`lookFiles`): its
  sheets (`sheets`) and its parts of JS (`scripts`), in the order in which
  Vite preloads them when the look is imported. The script of the page writes
  a `<link rel="stylesheet">` for each sheet of the skin kept (`document.write`,
  while the page is read): a stylesheet of the parser blocks the first paint
  and the scripts after it in every browser, so someone who chose Nuit never
  sees Crête first, on every page, the pages to sign in included. It writes a
  `<link rel="modulepreload">` for each part, so that the look loads with the
  entry rather than after it. The look's own import finds those links in the
  page and adds none. In the dev server, the table has no files: the look
  brings its sheets, after a short flash.
- **Offline**: the service worker (`public/sw.js`) keeps every file of
  `/assets/` the first time it is asked for (sheets, parts, faces) and the page:
  a skin chosen once is drawn offline the next time (`sw.test.ts`).

The sheets of a look come before `styles.css` in the page of a skin kept, and
after it when the skin is chosen: what they draw must not depend on it.

- The palette's rules are outside the layers, so they win over `@theme` (layer
  `theme`) and the dark blocks of Crête (layer `base`) in either order.
- The utilities of a look carry the prefix of its folder (`nuit:size-12`), so
  none of them is a selector of `styles.css`: in the same layer, a rule of
  each sheet would win or lose by the order alone (`.hidden` against
  `.md\:flex`). The only selectors they share are Tailwind's own (`:root`, `*`),
  with the look's prefixed properties, or the same values as the entry's.
  `build.test.ts` checks it on the real build; `cascade.test.tsx` draws every
  skin's motifs and the agenda at 1280 px with the look's sheets before and
  after `styles.css`, and finds the same boxes.
- `utilities.css` declares the order of the layers first, as `styles.css` does.

## Adding a skin, step by step

1. Create `skins/<id>/index.ts` as above.
2. Write `fonts.css` (see Fonts), and `palette.css`: custom properties only (see
   Colours), under the skin's selectors.
3. Draw its motifs as components of the slots it changes, their classes of
   Tailwind with the folder's prefix (`<id>:size-12`, `<id>:md:size-14`); write
   `utilities.css` as the other skins' (see Utilities) and add the folder to
   the list of `styles.css`.
4. Write `look.ts`: the imports of its sheets, and `slots`.
5. If its titles' font is new, add its latin face to `samples.css` (see Fonts).
6. Run `pnpm --dir web test`. The tests go through the new skin in each of its
   modes, without being edited: the contrast tests (`dark`, `contrast`,
   `dashed`, `slope`, the sky included), the guards of its stylesheets, the
   registry and its look, the table of `index.html`, the build, the picker, and
   the smoke battery of the pages at 320 px.

## Colours (palette.css)

A skin sets custom properties that `styles.css` declares for Crête (`@theme` and
`:root`), and nothing else (a test says so): no rule on a class. Every utility
reads them, whatever its variant (`aria-[current=page]:bg-dawn-deep`, `hover:…`),
so a skin that sets them is followed everywhere.

Two kinds of Crête's properties are not a palette's to set (the guard refuses them):

- `--shadow-*`: Tailwind writes these shadows into its utilities (`shadow-glow`,
  `shadow-card`…), so a value set on a page never reaches them. Only the
  variables inside them do: a skin sets those (`--shade-*`, `--shade-edge*`,
  `--dawn-glow-warm`, `--dawn-glow-cool`, below).
- `--font-*`: fonts live in `fonts.css` only (see Fonts).

What a palette sets:

- The colours: `--color-neutral-*`, `--color-ink`, `--color-iris-*` (the accent),
  `--color-peach-*`, `--color-blush-*`, `--color-red-*`, `--color-card`,
  `--color-raised`, `--color-field`, `--color-rim`, `--color-toast`,
  `--color-scrim`, `--color-relief`, `--color-slope-1…5`.
- The rest of the theme: `--radius-*`; the colours of the shadows
  (`--shade-card`, `--shade-lift`, `--shade-bar`, and `--shade-edge`,
  `--shade-edge-lift`, the thin line under a card, a card that lifts, the tab bar;
  `--shade-dialog`, a window, `components/Dialog`; `--shade-welcome`, the card of
  the sign-in pages, `routes/__root`);
  `--map-frame`, `--map-veil`, `--sheet-glow`. Every skin sets `--shade-dialog`
  and `--shade-welcome` in its own colours: Crête's are a violet glow.
- The card of the sign-in pages (`routes/__root`), Crête's frosted glass (`glass`:
  82 % of `--color-card` over the sky):

  | Property         | Crête                                                    | What paints with it                                                                                                                                                          |
  | ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `--welcome-card` | `transparent`                                            | the ground laid over the glass (`welcome-card`): a `#rrggbb` card for a skin whose sky is dark (white glass on it is a flat grey); ink, labels, hints and errors 4.5:1 on it |
  | `--welcome-rim`  | `color-mix(in oklab, var(--color-rim) 70%, transparent)` | its border                                                                                                                                                                   |

- The shades and veils of the pieces, on the sky of a hero and elsewhere (a
  palette sets them where Crête's plum would be off-hue):

  | Property          | Crête                     | What paints with it                                                                          |
  | ----------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
  | `--shade-toast`   | `rgb(36 27 53 / 0.7)`     | the shadow of a message (`components/Toast`)                                                 |
  | `--shade-notes`   | `rgb(36 27 53 / 0.6)`     | the shadow of the notes of an event on its hero                                              |
  | `--shade-photo`   | `rgb(36 27 53 / 0.6)`     | the shadow of the photo of a runner on its hero                                              |
  | `--photo-ring`    | `rgb(255 255 255 / 0.85)` | the ring that cuts that photo out of the sky                                                 |
  | `--shade-on-dawn` | `rgb(36 27 53 / 0.5)`     | the shadow of a white pill on a hero (`ON_DAWN`, « S'inscrire »)                             |
  | `--hero-veil`     | `rgb(36 27 53 / 0.2)`     | the veil under the end of the registrations on a hero; at 90 %, in the ring of the days left |

  Fainter shades are still written out, in Crête's pieces: the secondary button
  (`buttons.ts`), the tabs of the admin (`AdminLayout`), a field (`Field`), the
  close button of a window (`Dialog`), the glint of the day of an event (`Dawn`).

- The style of the display face in the titles (`.page-title`, `.block-title`,
  `.card-title`, and `display-title`: the title of the hero of an event or of a
  runner, of the card of an event, of a window):

  | Property              | Crête      | What it does                                                                                        |
  | --------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
  | `--display-style`     | `normal`   | `font-style` (`italic`: the face must have its italic, at 700 and 800; `fonts.test.ts` checks it)   |
  | `--display-transform` | `none`     | `text-transform` (`uppercase`)                                                                      |
  | `--display-stretch`   | `normal`   | `font-stretch` (`112.5%`: the face must cover that width, a variable `wdth` axis; `fonts.test.ts`)  |
  | `--display-tracking`  | `-0.025em` | the letter-spacing of the title of a page, a hero, a window; a block's and a card's are 0.01em more |

  The rule of `styles.css` on every `h1, h2, h3, legend, summary` (the display
  face, -0.01em) stays outside `--display-*`: a title in the display face that
  should take the skin's style carries one of the classes above or
  `display-title` (the month of the agenda does).

- The map of a track (`features/route/TrackMap`, which stays light at night):

  | Property                         | What paints with it                                                                              |
  | -------------------------------- | ------------------------------------------------------------------------------------------------ |
  | `--map-line-from`, `-via`, `-to` | the gradient of the line of the track                                                            |
  | `--map-line`                     | the line where a gradient cannot be drawn (a track due east or north)                            |
  | `--map-start`, `--map-finish`    | the dots of the start and of the finish (3:1 on white)                                           |
  | `--map-link`                     | the links of the attribution (4.5:1 on white)                                                    |
  | `--map-ink`                      | the words of the start and of the finish, the zoom buttons (4.5:1 on white and on `--map-hover`) |
  | `--map-hover`                    | a zoom button under the pointer                                                                  |
  | `--map-shade`                    | the shade of those words and of the zoom                                                         |

- Crête's motifs, which stand in for the slots a skin does not draw: a palette
  skin that sets these has them in its colours without drawing anything.

  | Property                                                                                           | What paints with it                                                                                               |
  | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | `--motif-ridge-far-from`, `-to`; `--motif-ridge-mid-from`, `-to`; `--motif-ridge-near-from`, `-to` | the three ridges, from their crest to their foot (`HeaderArt`, `HeroArt`; `-near-to` is also the band under them) |
  | `--motif-ridge-light`                                                                              | the light on the far crests                                                                                       |
  | `--motif-sun-core`, `-mid`, `-rim`; `--motif-halo-from`, `-to`                                     | the sun over the ridges, and its halo                                                                             |
  | `--motif-dawn-1`, `-2`, `-3`                                                                       | the sun of the mark of the app (`BrandMark`) and of an empty list (`EmptyArt`)                                    |
  | `--motif-peak-far`, `--motif-peak-near-from`, `-to`                                                | the two summits of the mark                                                                                       |
  | `--motif-hill-near-from`, `-to`                                                                    | the near hills of an empty list                                                                                   |
  | `--motif-mark-shade`, `--motif-name-shade`                                                         | the shade under the tile of the mark, behind the name of the app (`BrandMark`)                                    |
  | `--motif-sun-glow`                                                                                 | the glow of the sun of the divider (`Divider`)                                                                    |

- The paints of the dawn, which Crête writes out and the night leaves alone:

  | Property                           | What paints with it                                                                                                            |
  | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
  | `--dawn-deep`                      | `.bg-dawn-deep`: what carries a text (main button, current tab, «+», day of an event): every stop 4.5:1 with `--dawn-deep-ink` |
  | `--dawn-deep-ink`                  | the text, the icons and the marks on it (`text-dawn-deep-ink`…): `#ffffff` in Crête, a `#rrggbb` (a dark ink on a light dawn)  |
  | `--dawn-soft`                      | `.bg-dawn`: the soft sunrise, dark text only                                                                                   |
  | `--dawn-sky-color`, `--dawn-sky`   | `.bg-dawn-sky`: the header and the sign-in pages (white text)                                                                  |
  | `--dawn-hero-color`, `--dawn-hero` | `.bg-dawn-hero`: the heroes (white text, the notes, « S'inscrire »)                                                            |
  | `--dawn-text`                      | `.text-dawn`: big figures                                                                                                      |
  | `--dawn-line`                      | the line under `.page-title`, Crête's section marker                                                                           |
  | `--dawn-marker-shadow`             | the shadow of Crête's section marker                                                                                           |
  | `--dawn-horizon`                   | the line after `.month-title`                                                                                                  |
  | `--dawn-ring-from`, `-via`, `-to`  | the ring of the days left (CountdownRing)                                                                                      |
  | `--dawn-chip-glow`                 | the glow under the day of an event (DateChip)                                                                                  |
  | `--dawn-glow-warm`, `-cool`        | the halo of what `--dawn-deep` paints (`shadow-glow`: main buttons, current tab, «+»)                                          |
  | `--focus-glow`                     | the halo of a field with the focus                                                                                             |
  | `--sky-focus`                      | the ring of the focus on the sky: 3:1 on every stop of `--dawn-sky` and `--dawn-hero`                                          |

A skin without a halo sets both glows to `transparent` (`--dawn-glow-warm:
transparent; --dawn-glow-cool: transparent;`): `shadow-glow` is then drawn in
nothing, and the smoke test, which compares each piece's halo with that of
`shadow-glow` in the skin, accepts it.

```css
:root[data-skin="<id>"] {
  --color-neutral-50: #…;
  --color-iris-600: #…;
  --dawn-deep: linear-gradient(110deg, #… 0%, #… 50%, #… 100%);
}
```

The rules of a skin are outside the cascade layers, so they win over `@theme`
(layer `theme`) and the dark blocks of Crête (layer `base`), whatever the order
of the stylesheets.

### Dark mode

- One mode only: the page is always drawn in it (`data-theme` is set to it by
  `lib/theme.ts` and by `index.html`, whatever « Clair ou sombre » says), and the
  picker hides that choice. A dark-only skin sets its night colours under
  `:root[data-skin="<id>"]`, over Crête's dark ones.
- Both modes: the day under `:root[data-skin="<id>"]`, the night twice, value for
  value (a test compares them), as Crête does in `styles.css`:

  ```css
  :root[data-skin="<id>"][data-theme="dark"] {
    color-scheme: dark;
    --color-…: #…;
  }
  @media (prefers-color-scheme: dark) {
    :root[data-skin="<id>"]:not([data-theme="light"]) {
      color-scheme: dark;
      --color-…: #…;
    }
  }
  ```

  The day rule wins over Crête's night: every colour the skin sets by day that
  Crête changes at night must be set again in its night (a test says which).

### The sky (`.on-dawn`)

`.on-dawn` marks what sits on a sky: the header, the heroes, the name of the app
on the sign-in page. Crête puts its colours of the day back there, in both modes
(`:root:not([data-skin]) .on-dawn`). Under another skin the sky has the skin's
colours as they are. The tests measure, in every skin and mode: white text on the
linear stops of `--dawn-sky` and `--dawn-hero` (4.5:1), « S'inscrire » (`iris-700`
on a white pill, 4.5:1), the notes of an event (`ink` on a frosted card over the
hero, 4.5:1). A skin with both modes keeps the colours of its day on the sky at
night (a test, as for Crête, checks every property that Crête's night or its own
changes): it puts them back the same way:

```css
:root[data-skin="<id>"] .on-dawn {
  color-scheme: light;
  --color-…: #…;
}
```

### Forced colours

In forced colours (a high-contrast mode), the browser drops backgrounds and
gradients. `styles.css` gives an edge to what was a pill of colour (`.bg-dawn-deep`,
`.bg-red-700`, the current tab) and the colour of the text to the line of the
elevation profile; those rules hold under every skin (the smoke battery checks
the current tab and the «+»).

### Fonts

`fonts.css` holds the faces of the skin and the stacks that name them, and
nothing else (a test says so): `@font-face` rules, and `--font-sans`,
`--font-display` (and `--font-mono`, `--font-serif` when it has them) under
`:root[data-skin="<id>"]`. Its look imports it, with its palette.

```css
@font-face {
  font-family: "Space Grotesk Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 500 700;
  src: url("@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2")
    format("woff2");
  unicode-range: U+0000-00FF, …; /* the package's own, for this file */
}
:root[data-skin="<id>"] {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Space Grotesk Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
}
```

- The files are the ones of a package (`@fontsource-variable/<name>`, exact
  version in `package.json`; `@fontsource/<name>` for a font with no variable
  build, one file per weight and style), written by hand as Crête's are: a
  latin-ext face and a latin face, with the unicode-range of the package's own
  CSS, `font-display: swap`, the weights the skin uses and no others. Never the
  package's stylesheet (it brings every script), never a host.
- A family is declared once. One that two skins use is in `shared/fonts.css`,
  for the union of their weights (Outfit: « Sentier » and « Alpage »; Inter
  Tight: « Marathon » and « Chrono »), and both looks import that sheet: a look
  brings every face its stacks name (`fonts.test.ts` checks it). Inter and Plus
  Jakarta Sans are declared in `styles.css`: name them, do not declare them
  again.
- The browser fetches a face only when text is drawn in its family. None is
  preloaded (`index.html` has no preload) or precached (`public/sw.js` keeps
  the page only; a file of `/assets/` is kept when it is first requested).
- `fontSample` is the `--font-display` stack of the skin's `fonts.css` (Crête's
  when it has none; a test compares their families). The picker draws its
  « Aa » in it, whether the skin is worn or not: `samples.css`, which the section
  « Apparence » imports (so it comes with the settings page and no other),
  declares for each family that draws a sample its latin face at 700, the very
  file of the skin's own face. A face is fetched when its sample is drawn.
- Every family named in a stack of a `fonts.css` is declared by a face, of
  `styles.css` or of a `fonts.css` (a test checks every folder that has one).

## Utilities

`styles.css` scans the source of the app for the utilities of Tailwind it
uses, but not the folders of the skins other than Crête's, nor `shared/`
(`@source not "./skins/{alpage,…,shared}/**"`: a new skin adds its folder to
that list, `plugin.test.ts` says so). Each of these folders has its own
`utilities.css`, which its look imports, with the folder's prefix:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme) prefix(nuit);
@import "../../theme.css" prefix(nuit);
@import "../theme-vars.css" prefix(nuit);
@import "tailwindcss/utilities.css" layer(utilities) source(none);
@source "./*.tsx";
```

- The motifs of the folder write their classes with the prefix
  (`nuit:absolute nuit:w-40 nuit:md:w-56`), and this sheet makes only those:
  never a selector of `styles.css` (see Loading on demand). A class without
  the prefix is made by nothing (`plugin.test.ts` refuses an utility without
  it). A class that is not one of Tailwind keeps its name: `route-dots` of
  `styles.css`, a hook.
- It reads the app's theme (`theme.css`: the `@theme` and the `@utility` of
  the app, which `styles.css` imports in its place). With a prefix, Tailwind
  would read a prefixed copy of each property of the theme (`--nuit-color-iris-600`,
  with Crête's value); `theme-vars.css` makes the colours, the radii and the
  fonts read the page's own properties instead (`var(--color-iris-600)`), the
  ones the skin's palette and fonts set. `src/skins/` is scanned by
  `styles.css`, so the entry declares every one of them, for every page.
- It declares the order of the layers first, for a page that reads it before
  `styles.css`.

So the stylesheet of every page has only Crête's utilities.

## Slots (motifs)

The motifs are components in named places of the app (`types.ts`, `SlotProps`).
The app draws them through `slotted(name)` (`components.tsx`), made once per slot
in `components/Slots.tsx`; it draws `useSlot(name)`: the skin's own, or Crête's.

| Slot            | Props                                  | Where                                                                                                                            |
| --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `HeaderArt`     | `place: "header" \| "welcome"`, `sun?` | the sky of the header (AppShell), the sign-in pages (\_\_root)                                                                   |
| `BrandMark`     | `size?: "md" \| "lg"`                  | the name of the app after its mark, on the sky                                                                                   |
| `HeroArt`       | `place: "event" \| "runner"`           | behind the hero of an event, of a runner                                                                                         |
| `Divider`       | `className?`                           | between two blocks of the home page                                                                                              |
| `SectionMarker` | none                                   | the first child of every block title (`components/BlockTitle.tsx`)                                                               |
| `EmptyArt`      | none                                   | over the words of an empty list (EmptyState)                                                                                     |
| `PageArt`       | none                                   | behind the content of every signed-in page: the first child of its sheet (`.sheet`, `components/AppShell.tsx`), under its `main` |

A motif is decoration: `aria-hidden="true"`, `focusable="false"` on an SVG,
nothing that the words around them do not say. Crête's long paths are in the page
once (`MotifDefs`, in `crete/Alpenglow.tsx`); a skin draws its own.

`PageArt` is drawn in the sheet of the page, which is the paper of the app: Crête
draws nothing there (`crete/PageArt.tsx` is `null`, so its page is what it was, and
so is that of a skin that does not draw one: `pageArt.test.tsx` checks that the
sheet holds the `main` and nothing else). A skin that draws there makes a box as
tall as the sheet (`position: absolute; inset: 0`), under the content
(`z-index: -1`, inside the sheet's own stacking context, so it is over the paper
and under every card and word), and never in the way of a tap
(`pointer-events: none`). The words behind which it lies must keep their 4.5:1 on
it: the palest text of the app on its paper is `neutral-600`, and a dot of the
art must not take it under that (`pageArt.test.tsx` measures it, on the pages
and on the token). « Carnet »'s is as tall as the screen at most, so that a long page does
not pay for its length: `position: sticky` in the box of the sheet, clipped by it.

`BrandMark` writes the name of the app (`t.common.appName`) as one text node, in
one element: the smoke battery finds it on the sign-in pages by its text
(`getByText(appName)`). A mark that splits it (« Prends ton » and « dossard » in
two faces) keeps the whole name in one element, its parts drawn by CSS or
hidden from that search.

A screen reader has nothing of a motif but the name of the app in `BrandMark`:
`components.test.tsx` draws every motif of every skin and checks what it says
(`said`, in `../test/said.ts`).

### What skins share

A skin's folder takes nothing from another skin's: its look is loaded alone.
What two skins share is in `shared/`, a folder with no `index.ts` (neither the
registry nor the table takes it), which their looks import:

- `shared/fonts.css`: the faces of Outfit and of Inter Tight (see Fonts);
- `shared/trail.tsx` (and `trailRidge.ts`): the art of a trail, the ridges, the
  sun, the patch and the blaze before a title, which « Sentier » and « Alpage »
  draw; `shared/utilities.css`, its utilities.

Crête's folder is in the entry, for everyone: `sentier/` and `alpage/` import
`Contours` from `../crete/Alpenglow`, and `shared/trail.tsx` a path of
`../crete/motifPaths`. `Contours` draws with the paths of Crête's `MotifDefs`,
which `routes/__root.tsx` renders once for every page, whatever the skin. It
must stay there: under Crête's `HeaderArt`, it would be missing from the pages
of the other skins, and Sentier's and Alpage's contours would vanish without an
error. `plugin.test.ts` checks that no folder of a skin imports another's.

### Motion

The app has no animation that never ends: it keeps a phone at work
(`../motion.test.ts`). What moves, moves once (a dialog that rises, a ring that
draws itself), and not at all when less motion is asked for. One exception,
for a skin whose background is alive (« Carnet »: the patches of its sheet of
dots that fade out and in, on its header, its heroes and, behind every page, its
sheet of the page; its orbits that turn, a dot that pulses): the
decoration of its motifs, in the `motion.css` of its folder, on these
conditions (`../motion.test.ts` checks the file, and `animatedBackground`):

- **Only for whoever has not asked for less motion**: every animation that never
  ends is inside `@media (prefers-reduced-motion: no-preference)`. Under
  `reduce` the drawings are all there, standing still.
- **Only while the person has it on.** Motion that lasts more than five seconds
  must be stoppable (WCAG 2.2.2): Réglages → Apparence → « Animer le fond », a
  switch shown for a skin that says `animatedBackground: true`, on by default
  and kept on the device (`localStorage["ptd-ambient"]`, nothing when on,
  `lib/ambient.ts`; the settings page owns it, `AmbientSwitch`). A motif that moves reads
  `useAmbient()` and gives its drawing `data-moving` while it is on; the
  stylesheet moves only what is inside `[data-moving]`. Off, the same
  drawings stand still, at once, in every tab of the device.
- **Only decoration, only its own classes**: `motion.css` is the layout of the
  drawings that move and their motion, in classes that all start with the
  skin's id (`carnet-*`), never a class of the app, so the file cannot restyle
  the structure; the motifs that move use these classes and no Tailwind utility
  (the sheet of a skin must not depend on how it loads next to `styles.css`). It
  has no colour of its own (a custom property of the palette); its keyframes
  declare only `transform` and `opacity`, which the compositor does alone, so
  that the cost is a few small layers and not a repaint of the page.
- The motifs stay silent (`aria-hidden`, nothing to read: `components.test.tsx`),
  and nothing in them can be touched.

The look loads it (`import "./motion.css"`). Without `data-moving`, or under
`reduce`, a patch (`carnet-veil`) is a patch at rest, and the ring of a pulse is
not drawn.

## Semantic classes

The pieces of the app carry a class of their own beside their Tailwind
classes: stable hooks for the tests (the smoke battery finds `.event-hero`,
`.btn-primary`…) and for any later sheet of a skin. They carry no style of
Crête but `.page-title` and `.block-title`, and none is a utility of Tailwind
(`classes.test.ts`). A sheet that hooks on them hooks on these classes and on
the attributes of a state, never on a utility class or on the place of an
element in the markup.

| Class                                                           | Element                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `.app-header`                                                   | the header of a signed-in page, on the sky                  |
| `.tabbar`, `.tab`                                               | the bar of the tabs (`nav`), each tab (`a`, `aria-current`) |
| `.fab`                                                          | the floating « + » that creates an event                    |
| `.event-card`                                                   | an event in a list                                          |
| `.event-hero`, `.runner-hero`                                   | the top of the page of an event, of a runner                |
| `.page-title`                                                   | the `h1` of a page (with its line, `::after`)               |
| `.section-title`                                                | the `h2` of a block (`BlockTitle`, also `.block-title`)     |
| `.stat-tile`                                                    | a figure of a track (km, D+, D−), a total of the stats      |
| `.chip`, `.date-chip`                                           | a runner on an event card, the day of an event              |
| `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-on-dawn` | the buttons (`components/buttons.ts`)                       |
| `.card`, `.month-title`, `.eyebrow`, `.sheet`                   | already in `styles.css`                                     |

They also carry classes of `styles.css`, which draw Crête's look:

| Class                       | Element                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `.on-dawn`                  | what sits on a sky: the header, the heroes (see « The sky »)                    |
| `.card-lift`                | a card that lifts under the pointer: an event card                              |
| `.glass`                    | a frosted card: the notes of an event on its hero, the card of the sign-in page |
| `.avatar-soft`              | the photo of a runner on their hero (the pastel of their initials)              |
| `display-title` (a utility) | the title of a hero, of an event card, of a window, the month of the agenda     |

The parts of a piece are named after it (`.dialog-title` is in `.dialog`):

| Area                   | Classes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The frame              | `.app-header-bar` (its row: the name of the app), `.brand-link` (the name, a link home), `.tabbar-list` (the `ul` of the tabs), `.tab-icon` (the drawing over the word of a tab), `.offline-banner`, `.toasts` (where the messages rise), `.toast` (a message), `.toast-dot` (its dot)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A window               | `.dialog` (the panel, the `<dialog>`), `.dialog-content` (its padding), `.dialog-glow` and `.dialog-band` (the glow and the line of dawn at its top: decoration), `.dialog-head` (the row of the title and the close button), `.dialog-title`, `.dialog-close`, `.dialog-body` (what it holds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A form                 | `.field` (a label, its control, its hint and its error; a `fieldset` for a duration or a time), `.field-label` (the `label` or the `legend`), `.field-input` (every input, select and text area: `INPUT`), `.field-readonly` (a text to copy), `.field-hint`, `.field-error`; `.event-form`, `.form-card` (its white cards), `.format-fieldset` and `.format-legend` (a format of the form, its « Épreuve 1 »), `.period-line` (the line under the dates), `.duplicate-hint`, `.form-actions`; `.login-form`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Lists and filters      | `.filters` (the box of the filters), `.filter-field` (one of them), `.filter-label`; `.month-section` (a month of the list), `.event-list` (the cards of a list: the list, the group's next events, a day of the agenda; the list page lays a month's in two columns from `md`, in every skin); `.empty-state`; `.load-failure`; `.provisional` (the page before the app)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| An event card          | `.event-card-head` (the day and what is beside it), the parts of Crête's day (`.date-chip`): `.date-chip-top` (the weekday, or the first month over two months), `.date-chip-day`, `.date-chip-bottom` (the month), `.date-chip-year`, `.event-card-title`, `.event-card-place`, `.event-card-deadline` (`data-kind`), `.event-card-body` (what is under the head), `.event-card-people` (`data-kind`: `interested`, `supporters`), `.event-card-formats`, `.event-card-format`, `.format-line` (the line of a format: `FormatLine`), `.format-name`, `.format-parts`, `.format-date`; `.chips` (the runners of a card), `.chip` (`data-confirmed`), `.avatar` (`data-tint` on the initials)                                                                                                                                                                                                                                                                                                 |
| The page of an event   | `.event-hero-body` (the words of Crête's hero, its padding), `.event-hero-title`, `.event-hero-facts` (the date and the place), `.event-hero-deadline` (`data-kind`), `.event-hero-notes`, `.register-link`; `.event-page`, `.register-reminder` (the box that says to register), `.event-actions`, `.event-action` (`data-action`), `.event-sections`, `.event-section` (a white card of the page: `SECTION`, `data-section` on the interested and the supporters), `.format-section`, `.format-title` and `.format-measures` (Crête's title of a format: `FormatTitle`), `.format-date`, `.format-empty`, `.participant-list`, `.participant-row` (`data-confirmed`), `.participant-name`, `.participant-detail`, `.participant-unconfirmed`, `.non-starters`, `.non-starters-summary`, `.menu-button`, `.menu-popover`, `.menu-item` (`aria-current`), `.menu-check`; `.comments`, `.comment`, `.comment-form`; `.offers` (`data-kind`: `ride`, `lodging`), `.offer`, `.offer-passengers` |
| A track                | `.route-section` (the course of a format, under it), `.route-title`, `.route-figures` (Crête's tiles of the figures: `TrackFigures`), `.route-altitude`, `.route-links`, `.map-box` (the frame of the map, and of what stands in for it), `.map-loading`, `.map-unavailable`, `.track-map` and Leaflet's own classes (`TrackMap.css`); `.elevation-profile`, `.profile-chart`, `.profile-grid`, `.profile-baseline`, `.profile-line`, `.profile-label`, `.profile-tick`, `.profile-summit`, `.profile-reading` (the figures over the summit or the cursor), `.profile-cursor`, `.profile-legend`                                                                                                                                                                                                                                                                                                                                                                                             |
| The home page          | `.home-page`, `.passkey-card` (the card that offers a key to sign in), `.passkey-card-glow`, `.passkey-card-title`, `.passkey-card-text`, `.passkey-card-actions`; `.page-block` (a block of a page, `data-block`: `pending`, `results`, `registrations`, `upcoming`, `group`, `comments`, and on a runner's page `years`, `history`), `.race-list` (the rows of a block), `.pending-row` (to confirm: its dashes say it), `.result-row`, `.todo-row`, `.todo-countdown`, `.upcoming-row` (`data-confirmed`), `.days-left` (the days left in words, beside a ring), `.countdown-ring` (Crête's ring: `CountdownRing`), `.latest-comment`, `.latest-comment-mark`                                                                                                                                                                                                                                                                                                                             |
| The agenda             | `.agenda-month` (the month and its grid), `.month-nav`, `.month-nav-title`, `.nav-arrow` (the arrows of a month, of the stats), `.month-grid`, `.month-grid-weekday`, `.agenda-cell` (`data-in-month`), `.agenda-day` (a day on a phone: `aria-pressed` when chosen, `aria-current="date"` today), `.agenda-day-number` (also the `time` of a day from `md`, `aria-current="date"`), `.agenda-dots`, `.agenda-dot`, `.agenda-cell-body` (a day from `md`), `.agenda-events`, `.agenda-event`, `.day-list`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Profile, runner, stats | `.profile-section` (a part of the profile or of the settings: a `.card` too when it is boxed), `.avatar-picker`, `.skin-choice`, `.mode-choice` and `.ambient-switch` (the choices of « Apparence », `:has(:checked)`), `.passkey-row` (a key, in the settings and in the admin), `.runner-hero-title`, `.history-row`, `.result-tag`; `.totals` (a table of totals), `.totals-header` (its titles, from `sm`), `.totals-row`, `.totals-head`, `.stat-tile-title` (the title of a tile on a phone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The admin              | `.admin-nav`, `.admin-tabs` (its list), `.admin-tab` (`aria-current`), `.member-row`, `.type-row`, `.event-picker`, `.event-picker-option`, `.admin-choice` (`data-checked`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The sign-in pages      | `.welcome` (the whole page, on the sky), `.welcome-head` (the name of the app over the card), `.welcome-card` (the card: a utility of `styles.css`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

A state is an attribute, never a utility: `data-kind` (`open`, `closed`) on a
deadline, `data-confirmed` (`true`, `false`) on a chip or a row, `aria-current`
on a tab, `aria-pressed` on a chosen day, `data-in-month`, `data-checked`,
`data-action` (`join`, `add`, `calendar`, `edit`, `delete`).

## Tests

- `index.test.ts`: the registry, each skin's index (nothing but types) and its
  look (its sheets, nothing of another skin), the choice (kept, applied after
  its look is loaded, the last one winning, a look that fails, refused
  storage, other tabs, the skin of the page kept in memory), the start
  (`showKeptSkin`: a skin removed since, a look that fails), the mode of a
  single-mode skin, the bar's colour, the slots' fallback.
- `plugin.test.ts`, `plugin.build.test.ts`, `noFlash.test.ts`: the skins of
  development out of a build, the table of the skins written in `index.html`
  in the order of their names, with the files of each look in the order Vite
  preloads them (a small app built for real), the script before the first
  paint (the sheets of the skin kept linked by the parser and its parts
  preloaded, on every page, signed in or not, reading nothing but the skin and
  the theme kept), no folder of a skin importing another's, the list of folders
  that `styles.css` does not scan, the prefix of their utilities and
  `theme-vars.css`.
- `build.test.ts`: the real app, built: the page of a person who stays on Crête
  links one stylesheet with nothing of another skin, and its entry and what it
  preloads have no motif of another skin; each other skin is a part of its
  own, with its sheets and its parts in the table; no rule of a look's sheet
  is on a selector of the entry's, and every property a look reads is set on
  the page; the faces of the samples come with the section « Apparence »
  only; nothing of the skin of development.
- `cascade.test.tsx`: in a browser at 1280 px, every skin's motifs and the
  agenda are drawn the same with the look's sheets before `styles.css` (a skin
  kept) and after it (a skin chosen).
- `lazy.test.tsx`: in a browser, in any order, a page before any choice has
  nothing of another skin; in the picker, a skin chosen is checked at once,
  and the page takes it once its look is loaded; a skin chosen has its palette in the page, once; signing out
  keeps the skin, on the device and on the page, and the page to sign in is
  drawn in it; a page without a session opened with a skin kept has it.
- `components.test.tsx`: `slotted` in each skin, and what every motif says to a
  screen reader (nothing; the name of the app for `BrandMark`).
- `tokens.test.tsx`: in each skin, Crête's motifs and the map of a track take
  every colour from a `--motif-*` or `--map-*` property: none written out, in an
  attribute, a style or the arbitrary value of a class (`shadow-[…]`,
  `drop-shadow-[…]`; a mask's is only an alpha); a window, `--shade-dialog`; a
  toast, the white pill and the ring of the days left on a hero, their shades
  and veil; the titles, the style of `--display-*`.
- `smoke.test.tsx`: every skin × mode, at 320 px: home, an event with its map,
  profile and a dialog, a runner, the form, a public page (its card in
  `--shade-welcome`, `--welcome-card` and `--welcome-rim`), the settings, forced
  colours; 44 px targets, the marks of the titles, the current tab, the «+» and
  the main button in the skin's paint, ink and halo (the halo of `shadow-glow`
  in the skin, transparent too), the current tab told apart from the others by
  more than the colour of its words (`toldApart`) and its words 4.5:1 on what is
  behind them (`textContrast` of `../test/computed.ts`); what the heroes say, the
  shades of their pieces and the style of their titles; what the skin's own
  sheet sets (`ownDeclaration` of `../test/computed.ts`: Crête declares every
  property, so the page alone would not say whether the skin set one).
- `../test/skinSheets.test.ts`: the forms a palette may and may not use
  (`sheetProblems`), and the stops a gradient may have.
- `../dark.test.ts`, `../contrast.test.ts`, `../dashed.test.ts`,
  `../features/route/slope.test.ts`: every skin × mode (`SKIN_CASES` of
  `../test/theme.ts`), the sky included (white text, « S'inscrire », the notes,
  and the ring of the focus at 3:1 on every stop), and the guards of the
  stylesheets (`dark.test.ts`: each `palette.css`, and the `fonts.css` of every
  folder).
- `../fonts.test.ts`: the faces of every `fonts.css` (the package's files, its
  own declaration of each, each once), the families and weights each skin
  needs, the faces each look brings, the faces of an italic or wider title
  (`--display-style`, `--display-stretch`), and those of the samples
  (`samples.css`).
- `../features/profile/ThemePicker.test.tsx`: the picker, its samples in the
  font of each skin (neither declared nor asked for before the module of the
  section), the edge of a swatch (3:1 on its card, in every skin and mode).
- `../features/pwa/sw.test.ts`: a skin chosen once is drawn offline.
- `lookFailure.test.ts`: the real app, built, in a real Chromium, with Vite's
  own helper loading the looks and the routes: a look that fails (404 or
  offline) does not reload the page and is chosen with its sheets once the
  network is back; a route chunk gone, online, reloads, and offline does not; a
  kept skin whose sheet fails is Crête, and one that fails once is asked for
  again. `sheets.test.tsx`: what the page has of a look's sheets.
- `../features/auth/accountSkin.test.ts`, `accountSkin.signin.test.tsx`,
  `session.test.ts`, `../features/profile/ThemePicker.account.test.tsx`: the
  skin on the account (what is saved, and in which order; sign-in, session
  restore and sign-out; an unknown skin; the choice that did not reach the
  account), the picker saving it, and its message when a look cannot be loaded.
  The rules of the field are the server's (`server/migrations/9j_user_skin.go`).
- `listGrid.test.tsx`: the list page in every skin, at 375, 767, 768, 1024 and
  1280 px: one column under `md`, two from it, the cards of a row as tall as
  each other, nothing of a card cut or past its edge.
- `carnet/motifs.test.tsx`: what moves in « Carnet » (the patches, the orbits, a
  pulse: their names, periods and directions), that nothing moves under
  `prefers-reduced-motion: reduce` or with « Animer le fond » off, that the
  motifs follow the choice while they are drawn.
- `../motion.test.ts`: no animation that never ends, but the `motion.css` of a
  skin on the conditions of « Motion »; `../lib/ambient.test.ts`: the
  background on or off, kept on the device.
- `pageArt.test.tsx`: what is behind the content of a page: nothing in Crête
  and in the skins that draw none (the sheet holds the `main`, nothing else, in
  each of them at 375 and 1280 px), and in « Carnet » the sheet of dots, in the
  sheet, under the content, out of the way of a tap, with the words on the paper
  keeping 4.5:1 on a dot too, on the pages and on `neutral-600`.
