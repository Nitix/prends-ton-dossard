# Skins

A skin dresses the app; it never changes what the app does. Each one is a folder
of this one, found by `import.meta.glob("./*/index.ts")` in `index.ts`: adding a
skin is adding a folder, no shared file is edited. « Crête » (`crete/`) is the
default: `styles.css` draws it, and a page without `data-skin` on `<html>` is in it.

The skin is chosen in Réglages → Apparence → « Thème », kept on the device
(`localStorage["ptd-skin"]`, nothing for Crête) and put on `<html data-skin="<id>">`,
with its mode and the colour of the browser's bar, by the script of `index.html`
before the page is first drawn, then by `applySkin`.

## The folder of a skin

```
skins/<id>/
  index.ts     the skin (required): `export const skin: Skin`
  fonts.css    its @font-face rules and `--font-*` (every depth)
  palette.css  its custom properties: colours, radii, colours of shadows, paints of the dawn,
               of the map and of Crête's motifs (depth palette)
  mix.css      its signature pieces (depth mix)
  full.css     every other piece (depth full)
  mix.tsx      components it replaces at depth mix:  `export const variants: Variants`
  full.tsx     components it replaces at depth full: `export const variants: Variants`
  *.tsx        its motifs, for the slots
```

`index.ts` (see `types.ts`):

```ts
export const skin: Skin = {
  id: "<id>", // the name of the folder
  label: { fr: "…", en: "…" }, // its name in the picker
  modes: ["light"], // ["light"], ["dark"] or ["light", "dark"]
  slots: { HeaderArt, BrandMark }, // the motifs it draws (Crête's stand in for the others)
  swatches: ["#rrggbb", "#rrggbb"], // two colours on its card
  fontSample: '"Its Font", serif', // the font-family of its titles, for the sample on its card
  themeColor: "#rrggbb", // the browser's bar (<meta name="theme-color">): the top of its header
};
```

`modes` and `themeColor` are read by the build too (`plugin.ts`, for the script
of `index.html`): keep them literal.

A folder whose name starts with `_` is a skin of development (`_example/`): the
dev server and the tests have it, in the picker too; a build has nothing of it
(`plugin.ts` makes each of its files an empty module exporting `skin` and
`variants`, the registry leaves it out, the table of `index.html` does not name
it, and `styles.css` does not scan its folder for classes: it styles its few
pieces inline).

## Adding a skin, step by step

1. Create `skins/<id>/index.ts` as above.
2. Write `fonts.css` (see Fonts), and `palette.css`: custom properties only (see
   Colours), under the skin's selectors.
3. Draw its motifs as components of the slots it changes, and list them in `slots`.
4. Run `pnpm --dir web test`, and with `VITE_SKIN_DEPTH=mix` and `=full` once it has
   deeper files. The tests go through the new skin in each of its modes, without
   being edited: the contrast tests (`dark`, `contrast`, `dashed`, `slope`, the
   sky included), the guards of its stylesheets, the registry, the table of
   `index.html`, the picker, and the smoke battery of the pages at 320 px.
5. Deeper: `mix.css`, `full.css`, and `mix.tsx` / `full.tsx` for markup variants.

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
  `--map-frame`, `--map-veil`, `--sheet-glow`.
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

  | Property                           | What paints with it                                                                                                    |
  | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
  | `--dawn-deep`                      | `.bg-dawn-deep`: what carries white text (main button, current tab, «+», day of an event): every stop 4.5:1 with white |
  | `--dawn-soft`                      | `.bg-dawn`: the soft sunrise, dark text only                                                                           |
  | `--dawn-sky-color`, `--dawn-sky`   | `.bg-dawn-sky`: the header and the sign-in pages (white text)                                                          |
  | `--dawn-hero-color`, `--dawn-hero` | `.bg-dawn-hero`: the heroes (white text, the notes, « S'inscrire »)                                                    |
  | `--dawn-text`                      | `.text-dawn`: big figures                                                                                              |
  | `--dawn-line`                      | the line under `.page-title`, Crête's section marker                                                                   |
  | `--dawn-marker-shadow`             | the shadow of Crête's section marker                                                                                   |
  | `--dawn-horizon`                   | the line after `.month-title`                                                                                          |
  | `--dawn-ring-from`, `-via`, `-to`  | the ring of the days left (CountdownRing)                                                                              |
  | `--dawn-chip-glow`                 | the glow under the day of an event (DateChip)                                                                          |
  | `--dawn-glow-warm`, `-cool`        | the halo of what `--dawn-deep` paints (`shadow-glow`: main buttons, current tab, «+»)                                  |
  | `--focus-glow`                     | the halo of a field with the focus                                                                                     |
  | `--sky-focus`                      | the ring of the focus on the sky                                                                                       |

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
the current tab and the «+»). A skin that paints a meaning with a background of
its own, in `mix.css` or `full.css`, adds its edge under
`@media (forced-colors: active)`, scoped to `:root[data-skin="<id>"]`.

### Fonts

`fonts.css` holds the faces of the skin and the stacks that name them, and
nothing else (a test says so): `@font-face` rules, and `--font-sans`,
`--font-display` (and `--font-mono`, `--font-serif` when it has them) under
`:root[data-skin="<id>"]`. It is bundled at every depth, before the palette.

```css
@font-face {
  font-family: "Outfit Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 500 800;
  src: url("@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2") format("woff2");
  unicode-range: U+0000-00FF, …; /* the package's own, for this file */
}
:root[data-skin="<id>"] {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Outfit Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
}
```

- The files are the ones of a package (`@fontsource-variable/<name>`, exact
  version in `package.json`; `@fontsource/<name>` for a font with no variable
  build, one file per weight and style), written by hand as Crête's are: a
  latin-ext face and a latin face, with the unicode-range of the package's own
  CSS, `font-display: swap`, the weights the skin uses and no others. Never the
  package's stylesheet (it brings every script), never a host.
- A family is declared once, in the `fonts.css` of the first skin that uses it
  (Outfit: « Sentier », also « Alpage »; Inter Tight: « Marathon », also
  « Chrono »), for the union of their weights; the other skin only names it in
  its stacks. Inter and Plus Jakarta Sans are declared in `styles.css`: name
  them, do not declare them again. A `_` folder is left out of a build, so
  nothing shared goes in one.
- The browser fetches a face only when text is drawn in its family. Every
  `fonts.css` is in the build, but a person who stays on Crête (no `data-skin`)
  draws nothing in them: no file is requested, none is preloaded (`index.html`
  has no preload) or precached (`public/sw.js` keeps the page only; a file of
  `/assets/` is kept when it is first requested).
- `fontSample` is the `--font-display` stack of the skin's `fonts.css` (Crête's
  when it has none; a test compares their families): the picker draws « Aa » in
  it once loaded, and never loads a font to show it.
- Every family named in a stack of a `fonts.css` is declared by a face, of
  `styles.css` or of a `fonts.css` (a test checks every folder that has one).

## Slots (motifs)

The motifs are components in named places of the app (`types.ts`, `SlotProps`).
The app draws them through `slotted(name)` (`components.tsx`), made once per slot
in `components/Slots.tsx`; it draws `useSlot(name)`: the skin's own, or Crête's.

| Slot            | Props                                  | Where                                                              |
| --------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `HeaderArt`     | `place: "header" \| "welcome"`, `sun?` | the sky of the header (AppShell), the sign-in pages (\_\_root)     |
| `BrandMark`     | `size?: "md" \| "lg"`                  | the name of the app after its mark, on the sky                     |
| `HeroArt`       | `place: "event" \| "runner"`           | behind the hero of an event, of a runner                           |
| `Divider`       | `className?`                           | between two blocks of the home page                                |
| `SectionMarker` | none                                   | the first child of every block title (`components/BlockTitle.tsx`) |
| `EmptyArt`      | none                                   | over the words of an empty list (EmptyState)                       |

A motif is decoration: `aria-hidden="true"`, `focusable="false"` on an SVG,
nothing that the words around them do not say. Crête's long paths are in the page
once (`MotifDefs`, in `crete/Alpenglow.tsx`); a skin draws its own.

## Semantic classes (mix and full)

The signature pieces carry a class of their own beside their Tailwind classes,
for a deeper skin to restyle them in `mix.css` or `full.css`. Crête draws them with
the Tailwind classes; the semantic classes carry no style of Crête but
`.page-title` and `.block-title`.

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

`mix.css` and `full.css` set no custom property (the colours stay in the palette,
where the contrast tests read them), and every rule is the skin's. The forms they
may use, and only these (`sheetProblems` in `../test/theme.ts`, tested on sheets of
its own in `../test/skinSheets.test.ts`, and run on every skin by `../dark.test.ts`):

- A rule whose every selector is `:root[data-skin="<id>"]`, then, for a rule of
  one mode, `[data-theme="dark"]`, `[data-theme="light"]` or
  `:not([data-theme="light"])`, then a combinator (a space, `>`, `+`, `~`) and the
  piece. A list is split at its own commas, not at those of `:is(a, b)` or
  `:where(…)`, so each of its selectors starts so.
- Such rules wrapped in `@media`, `@supports` or `@container`, as deep as needed
  (the night followed: `@media (prefers-color-scheme: dark)` with
  `:not([data-theme="light"])`; forced colours: `@media (forced-colors: active)`).
- `@keyframes <id>-<name>`: a name of the skin, since keyframes are global.
- Nothing else: no rule without the piece (`:root[data-skin="<id>"]` alone is the
  palette's), no nested rule, no `@font-face`, `@import` or `@layer`.

```css
/* mix.css */
:root[data-skin="<id>"] .event-card {
  border-radius: 0.375rem;
}
:root[data-skin="<id>"][data-theme="dark"] .tabbar ul,
:root[data-skin="<id>"] .tab:is([aria-current="page"], :hover) {
  box-shadow: none;
}
@media (min-width: 48rem) {
  :root[data-skin="<id>"] .app-header {
    min-height: 10rem;
  }
}
@keyframes <id>-rise {
  from {
    opacity: 0;
  }
}
```

## Depth (`VITE_SKIN_DEPTH`)

`palette` (default), `mix` or `full`, read at build time by `plugin.ts` (from the
environment, or the `.env` files of Vite's `envDir`), which fails the build on any
other value. It is a constant of the build: `SKIN_DEPTH` in `index.ts`
(`BUILD_SKIN_DEPTH`). The plugin points two modules at the files of the depth,
whose `import.meta.glob` calls take the files of that level and of the ones before
it, in order (a deeper sheet wins):

- `virtual:skin-styles` → `depth/<depth>.styles.ts`, the stylesheets. Only
  `styles.ts` imports it, and only `main.tsx` imports `styles.ts`, right after
  `styles.css`: the sheets of the skins are in the entry stylesheet, the one the
  page links, after Crête's. Imported by the registry (which Vite puts in a part
  shared with the pages), they would be a second stylesheet that every page
  waits for. A browser test that draws a skin imports `skins/styles` as it imports
  `styles.css`. The map's sheet stays its own, loaded with the map.
- `virtual:skin-depth` → `depth/<depth>.ts`, the variants, for the registry.

| Depth     | Stylesheets                                       | Variants              |
| --------- | ------------------------------------------------- | --------------------- |
| `palette` | `fonts.css`, `palette.css`                        | none                  |
| `mix`     | `fonts.css`, `palette.css`, `mix.css`             | `mix.tsx`             |
| `full`    | `fonts.css`, `palette.css`, `mix.css`, `full.css` | `mix.tsx`, `full.tsx` |

The files of a deeper level are not in the build at all (`plugin.build.test.ts`
builds a small app at each depth). The whole suite runs at each depth:
`VITE_SKIN_DEPTH=mix pnpm --dir web test`.

### Markup variants

A piece whose markup must change (the bib of « Dossard », the ticket of
« Rétro ») is made skinnable once, at the top of its module, under a name that
`VariantProps` (`types.ts`) gives with its props:

```tsx
// types.ts
export type VariantProps = { EmptyState: EmptyStateProps; EventCard: EventCardProps };

// features/events/EventCard.tsx
function EventCardBase(props: EventCardProps) { … }
export const EventCard = skinnable("EventCard", EventCardBase);
```

The skin exports the variant from `mix.tsx` or `full.tsx` (full wins over mix):

```tsx
export const variants: Variants = { EventCard: BibCard };
```

A name that is not in `VariantProps`, or a variant with other props, does not
typecheck. `EmptyState` is skinnable already (`_example/mix.tsx` replaces it).

## Tests

- `index.test.ts`: the registry, the choice (kept, applied, refused storage,
  other tabs, the skin of the page kept in memory), the mode of a single-mode
  skin, the bar's colour, the slots' fallback, the variants.
- `plugin.test.ts`, `plugin.build.test.ts`, `noFlash.test.ts`: the depth, the files of
  each depth in a real build (a skin of development included), the `.env`
  directory, the table of the skins written in `index.html` and its script
  before the first paint.
- `components.test.tsx`: `slotted` and `skinnable` in each skin, at the depth of the run.
- `tokens.test.tsx`: in each skin, Crête's motifs and the map of a track take
  every colour from a `--motif-*` or `--map-*` property: none written out, in an
  attribute, a style or the arbitrary value of a class (`shadow-[…]`,
  `drop-shadow-[…]`; a mask's is only an alpha); a window, `--shade-dialog`.
- `smoke.test.tsx`: every skin × mode, at 320 px: home, an event with its map,
  profile and a dialog, the form, a public page (its card in `--shade-welcome`),
  the settings, forced colours; 44 px targets, the marks of the titles, the
  current tab, the «+» and the main button in the skin's paint and halo (the halo
  of `shadow-glow` in the skin, transparent too; at palette only, since mix and
  full may restyle them); the skins' sheets in the page.
- `../test/skinSheets.test.ts`: the forms a palette, a mix and a full sheet may
  and may not use (`sheetProblems`), and the stops a gradient may have.
- `../dark.test.ts`, `../contrast.test.ts`, `../dashed.test.ts`,
  `../features/route/slope.test.ts`: every skin × mode (`SKIN_CASES` of
  `../test/theme.ts`), the sky included, and the guards of the stylesheets
  (`dark.test.ts`: the three levels, and the `fonts.css` of every folder).
- `../fonts.test.ts`: the faces of every `fonts.css` (the package's files, its own
  declaration of each, each once), and the families and weights each skin needs.
- `../features/profile/ThemePicker.test.tsx`: the picker, its font samples.
