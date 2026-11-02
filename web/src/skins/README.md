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

  Fainter shades are still written out, for mix and full: the secondary button
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
  | `--sky-focus`                      | the ring of the focus on the sky                                                                                               |

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

`BrandMark` writes the name of the app (`t.common.appName`) as one text node, in
one element: the smoke battery finds it on the sign-in pages by its text
(`getByText(appName)`). A mark that splits it (« Prends ton » and « dossard » in
two faces) keeps the whole name in one element, its parts drawn by CSS or
hidden from that search.

### What skins share

A skin may use the files of another, but the other then holds it:

- `alpage/` imports `../sentier/motifs` (the blaze, the patch, the ridges, the sun);
- `alpage/full.tsx` imports `terrainOf` from `../sentier/terrain` (the terrain of a
  race type, from its label);
- `sentier/` and `alpage/` import `Contours` from `../crete/Alpenglow`, and
  `sentier/motifs.tsx` (so Alpage too) a path of `../crete/motifPaths`;
- `Contours` draws with the paths of Crête's `MotifDefs`, which `routes/__root.tsx`
  renders once for every page, whatever the skin. It must stay there: under
  Crête's `HeaderArt`, it would be missing from the pages of the other skins, and
  Sentier's and Alpage's contours would vanish without an error.

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

The pieces made skinnable (below) also carry classes of `styles.css`, which draw
Crête's look and which a sheet may restyle there too:

| Class                       | Element                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `.on-dawn`                  | what sits on a sky: the header, the heroes (see « The sky »)                    |
| `.card-lift`                | a card that lifts under the pointer: an event card                              |
| `.glass`                    | a frosted card: the notes of an event on its hero, the card of the sign-in page |
| `.avatar-soft`              | the photo of a runner on their hero (the pastel of their initials)              |
| `display-title` (a utility) | the title of a hero, of an event card, of a window, the month of the agenda     |

Every other piece that a variant restyles has a class of its own too (Task 5),
for `full.css`. The parts of a piece are named after it (`.dialog-title` is in
`.dialog`):

| Area                   | Classes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The frame              | `.app-header-bar` (its row: the name of the app), `.brand-link` (the name, a link home), `.tabbar-list` (the `ul` of the tabs), `.tab-icon` (the drawing over the word of a tab), `.offline-banner`, `.toasts` (where the messages rise), `.toast` (a message), `.toast-dot` (its dot)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A window               | `.dialog` (the panel, the `<dialog>`), `.dialog-content` (its padding), `.dialog-glow` and `.dialog-band` (the glow and the line of dawn at its top: decoration), `.dialog-head` (the row of the title and the close button), `.dialog-title`, `.dialog-close`, `.dialog-body` (what it holds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A form                 | `.field` (a label, its control, its hint and its error; a `fieldset` for a duration or a time), `.field-label` (the `label` or the `legend`), `.field-input` (every input, select and text area: `INPUT`), `.field-readonly` (a text to copy), `.field-hint`, `.field-error`; `.event-form`, `.form-card` (its white cards), `.format-fieldset` and `.format-legend` (a format of the form, its « Épreuve 1 »), `.period-line` (the line under the dates), `.duplicate-hint`, `.form-actions`; `.login-form`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Lists and filters      | `.filters` (the box of the filters), `.filter-field` (one of them), `.filter-label`; `.month-section` (a month of the list), `.event-list` (the cards of a list: the list, the group's next events, a day of the agenda); `.empty-state`; `.load-failure`; `.provisional` (the page before the app)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| An event card          | `.event-card-head` (the day and what is beside it), the parts of Crête's day (`.date-chip`): `.date-chip-top` (the weekday, or the first month over two months), `.date-chip-day`, `.date-chip-bottom` (the month), `.date-chip-year`, `.event-card-title`, `.event-card-place`, `.event-card-deadline` (`data-kind`), `.event-card-body` (what is under the head), `.event-card-people` (`data-kind`: `interested`, `supporters`), `.event-card-formats`, `.event-card-format`, `.format-line` (the line of a format: `FormatLine`), `.format-name`, `.format-parts`, `.format-date`; `.chips` (the runners of a card), `.chip` (`data-confirmed`), `.avatar` (`data-tint` on the initials)                                                                                                                                                                                                                                                                                                 |
| The page of an event   | `.event-hero-body` (the words of Crête's hero, its padding), `.event-hero-title`, `.event-hero-facts` (the date and the place), `.event-hero-deadline` (`data-kind`), `.event-hero-notes`, `.register-link`; `.event-page`, `.register-reminder` (the box that says to register), `.event-actions`, `.event-action` (`data-action`), `.event-sections`, `.event-section` (a white card of the page: `SECTION`, `data-section` on the interested and the supporters), `.format-section`, `.format-title` and `.format-measures` (Crête's title of a format: `FormatTitle`), `.format-date`, `.format-empty`, `.participant-list`, `.participant-row` (`data-confirmed`), `.participant-name`, `.participant-detail`, `.participant-unconfirmed`, `.non-starters`, `.non-starters-summary`, `.menu-button`, `.menu-popover`, `.menu-item` (`aria-current`), `.menu-check`; `.comments`, `.comment`, `.comment-form`; `.offers` (`data-kind`: `ride`, `lodging`), `.offer`, `.offer-passengers` |
| A track                | `.route-section` (the course of a format, under it), `.route-title`, `.route-figures` (Crête's tiles of the figures: `TrackFigures`), `.route-altitude`, `.route-links`, `.map-box` (the frame of the map, and of what stands in for it), `.map-loading`, `.map-unavailable`, `.track-map` and Leaflet's own classes (`TrackMap.css`); `.elevation-profile`, `.profile-chart`, `.profile-grid`, `.profile-baseline`, `.profile-line`, `.profile-label`, `.profile-tick`, `.profile-summit`, `.profile-reading` (the figures over the summit or the cursor), `.profile-cursor`, `.profile-legend`                                                                                                                                                                                                                                                                                                                                                                                             |
| The home page          | `.home-page`, `.passkey-card` (the card that offers a key to sign in), `.passkey-card-glow`, `.passkey-card-title`, `.passkey-card-text`, `.passkey-card-actions`; `.page-block` (a block of a page, `data-block`: `pending`, `results`, `registrations`, `upcoming`, `group`, `comments`, and on a runner's page `years`, `history`), `.race-list` (the rows of a block), `.pending-row` (to confirm: its dashes say it), `.result-row`, `.todo-row`, `.todo-countdown`, `.upcoming-row` (`data-confirmed`), `.days-left` (the days left in words, beside a ring), `.countdown-ring` (Crête's ring: `CountdownRing`), `.latest-comment`, `.latest-comment-mark`                                                                                                                                                                                                                                                                                                                             |
| The agenda             | `.agenda-month` (the month and its grid), `.month-nav`, `.month-nav-title`, `.nav-arrow` (the arrows of a month, of the stats), `.month-grid`, `.month-grid-weekday`, `.agenda-cell` (`data-in-month`), `.agenda-day` (a day on a phone: `aria-pressed` when chosen, `aria-current="date"` today), `.agenda-day-number` (also the `time` of a day from `md`, `aria-current="date"`), `.agenda-dots`, `.agenda-dot`, `.agenda-cell-body` (a day from `md`), `.agenda-events`, `.agenda-event`, `.day-list`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Profile, runner, stats | `.profile-section` (a part of the profile or of the settings: a `.card` too when it is boxed), `.avatar-picker`, `.skin-choice` and `.mode-choice` (the choices of « Apparence », `:has(:checked)`), `.passkey-row` (a key, in the settings and in the admin), `.runner-hero-title`, `.history-row`, `.result-tag`; `.totals` (a table of totals), `.totals-header` (its titles, from `sm`), `.totals-row`, `.totals-head`, `.stat-tile-title` (the title of a tile on a phone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The admin              | `.admin-nav`, `.admin-tabs` (its list), `.admin-tab` (`aria-current`), `.member-row`, `.type-row`, `.event-picker`, `.event-picker-option`, `.admin-choice` (`data-checked`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The sign-in pages      | `.welcome` (the whole page, on the sky), `.welcome-head` (the name of the app over the card), `.welcome-card` (the card: a utility of `styles.css`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

A state is an attribute, never a utility: `data-kind` (`open`, `closed`) on a
deadline, `data-confirmed` (`true`, `false`) on a chip or a row, `aria-current`
on a tab, `aria-pressed` on a chosen day, `data-in-month`, `data-checked`,
`data-action` (`join`, `add`, `calendar`, `edit`, `delete`). A rule hooks on
these classes and attributes, and on nothing else of the markup: never on a
utility class (`p.rounded-full`, `.bg-neutral-100`, `.hover\:bg-iris-50`), never
on the place of an element in Crête's markup (`.event-hero > div`,
`.event-card > div + div`, `> span:nth-child(2)`). A piece that has no class
is asked for in `README.md` and in the shared code, not hooked another way.

A dashed border or outline in `mix.css` or `full.css` is either a state, in a
colour of the theme with 3:1 on a card and on the sheet in each mode of the
skin, or a decoration of the list in `../dashed.test.ts` (`DECORATION`, by the
class of its piece: `.bib-tear`, `.perforation`…), which is never read as « not
confirmed ».

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
export type VariantProps = { EmptyState: EmptyStateProps; EventCard: EventCardProps; … };

// features/events/EventCard.tsx
export function EventCardBase(props: EventCardProps) { … }
export const EventCard = skinnable("EventCard", EventCardBase);
```

The app draws the skinnable one (`EventCard`); `…Base` is Crête's, exported for
the tests. The pieces made skinnable:

| Name            | Where                             | Props (`types.ts`)                               | What it is                                                                                                   |
| --------------- | --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `EmptyState`    | `components/EmptyState.tsx`       | `title`, `hint`                                  | a list with nothing in it                                                                                    |
| `EventCard`     | `features/events/EventCard.tsx`   | `view`, `list`                                   | an event in a list (`.event-card`): home, upcoming, past, agenda                                             |
| `EventHero`     | `features/events/EventHero.tsx`   | `view`, `heading`                                | the top of the page of an event (`.event-hero`), its `h1`                                                    |
| `DateChip`      | `components/Dawn.tsx`             | `start`, `end?`, `label`, `size?` (`md`, `lg`)   | the day or days of an event (`.date-chip`), a picture; `label` says it                                       |
| `RunnerHero`    | `features/runners/RunnerHero.tsx` | `runner` (undefined while loading), `heading`    | the top of the page of a runner (`.runner-hero`), their photo and their `h1`                                 |
| `FormatTitle`   | `features/events/FormatTitle.tsx` | `formatView`, `parts`                            | the words of the title of a format on the page of an event: its name, then its measures (`.format-title`)    |
| `TrackFigures`  | `features/route/TrackFigures.tsx` | `figures`, `altitude`, `start?`                  | the figures of a track over its map: length, gain, loss, then the altitudes (`.route-figures`, `.stat-tile`) |
| `CountdownRing` | `components/Dawn.tsx`             | `days`, `tone?` (`color`, `light`), `className?` | the days left before a race or a deadline, a picture (`.countdown-ring`); the words beside it say them       |

- `view` is the event as the app has it (`EventView`): the event, its formats with
  who starts them, the interested and the supporters, its days.
- `list` tells the lists apart, for a variant that marks them (Crête does not):
  `home` (the group's next events), `upcoming` and `past` (the list), `agenda`.
- `parts` are the words of a format as `formatMeasures` gives them (its name,
  then its measures); `figures` the figures of a track in words (« 12,6 km »,
  « 724 m D+ », « 728 m D− »), `altitude` its lowest and highest points in
  words or null, `start` its first point (for a picture of where it starts). A
  variant keeps every word, in its order (a measure in a tag keeps its
  separator « · » in the text, `sr-only`).
- A `CountdownRing` is decoration: a variant stays hidden from screen readers
  (`aria-hidden`), or draws nothing (the words beside it say the days: a skin
  that marks them otherwise styles `.days-left`).
- `heading` is what the `h1` of a hero carries: spread it on the variant's `h1`
  (`<h1 {...heading}>`). It holds its id (the actions name it), the attribute the
  page gives the focus by, `tabIndex={-1}`, and the ref of a runner's title.
- What a piece shows besides, it reads as Crête's does, with the shared
  helpers rather than a copy of their code:
  - the day: `useToday`, `daysBetween`, and `daysToGo(start, end, today)`
    (`lib/dates.ts`), the days left before an event for a countdown: 0 on its
    first day and while it is under way, null once it is over;
  - the registration: `registrationState`, `registrationLabel` (« Inscriptions
    jusqu'au … », « Inscriptions closes »), and `deadlineText(state, f, t)`
    (`features/events/registration.ts`), the sentence of a hero: the label, and
    in the last week the days left after « · » (`DAYS_LEFT_SHOWN`); `webAddress`,
    and the link to register, `RegisterLink`;
  - the formats: `FormatLine` (`features/events/FormatLine.tsx`), the line of a
    format on a card, which a variant marks its own way with `marks` (`before`:
    a picture before the parts; `name`: how the name is drawn; `measure`: how
    each measure is drawn, a tag or a chip, its separator kept in the text and
    hidden from the eye) and the classes of its line (`className`); `FormatParts`,
    the same parts with their marks, for a title of a variant's own
    (`FormatTitle`); `formatMeasures` for the words alone;
  - the runners: `ParticipantChips`; the days left: `CountdownRing`
    (`components/Dawn.tsx`).

The skin exports the variant from `mix.tsx` or `full.tsx` (full wins over mix):

```tsx
export const variants: Variants = { EventCard: BibCard };
```

A name that is not in `VariantProps`, or a variant with other props, does not
typecheck.

**A variant gets the base as a prop.** `skinnable` draws the variant with the
props of the piece and `Base`, the piece as Crête draws it (with the skin's own
motifs in its slots), so that the variant can frame or wrap it rather than draw
it again (`VariantPropsOf<N>` in `types.ts`). Take `Base` out of the props
before passing them on; `Base` takes the props alone. A variant of `full.tsx`
gets Crête's piece too, not the variant of `mix.tsx`. The pieces nest: Crête's
card draws its day with `DateChip`, so a skin's day is in its card, base or not.

```tsx
// skins/<id>/mix.tsx: a frame around Crête's card
function BibCard({ Base, ...props }: VariantPropsOf<"EventCard">) {
  return (
    <div className="bib">
      <Base {...props} />
    </div>
  );
}
```

A variant that draws its own markup instead keeps everything the base shows and
does: every text (the statuses, the counts, the D+ figures, the dates), every
link and every action, the `h1` with `heading`, the date in words (`label`) for
a picture hidden from screen readers. Only the markup differs. It keeps the
semantic class of the piece (`.event-card`, `.event-hero`, `.runner-hero` on its
outer element, `.date-chip` on the picture of the day), which `mix.css` restyles
and the smoke battery finds. The variant of `DateChip` sits in the card's row of
flex items: its outer element must not shrink (`shrink-0 self-start`, as Crête's
picture has), or the day is squashed on a narrow screen.

`_example/mix.tsx` replaces `EmptyState`, frames Crête's `EventCard` (a thick
line, dashed in the agenda) and puts a line over Crête's `EventHero`.
`components.test.tsx` checks, in every skin, that a hero keeps the title its page
gives it (`heading`).

**A variant closes a cycle of imports.** A `mix.tsx` that imports a module of
the app (`RegisterLink`, `FormatLine`, `DateChip`…) is reached from
`skins/index` through the depth module, and reaches it back. It is safe while
both hold:

- the variant uses what it imports while it renders, never when its module is
  evaluated (no call or read at the top of the file);
- nothing imports a `mix.tsx` or `full.tsx` directly, in the app or in a test:
  a variant is reached through the registry (`variantOf(skinId, name)`, or the
  app's piece). A module that entered a `mix.tsx` before the registry would find
  it unfinished: natively, an error (« Cannot access … before initialization »);
  bundled, that skin's variants silently missing. The one exception,
  `components.test.tsx`, imports the registry first.
- A variant never imports the piece it replaces: it gets it as `Base`.

## Tests

- `index.test.ts`: the registry, the choice (kept, applied, refused storage,
  other tabs, the skin of the page kept in memory), the mode of a single-mode
  skin, the bar's colour, the slots' fallback, the variants.
- `plugin.test.ts`, `plugin.build.test.ts`, `noFlash.test.ts`: the depth, the files of
  each depth in a real build (a skin of development included), the `.env`
  directory, the table of the skins written in `index.html` and its script
  before the first paint.
- `components.test.tsx`: `slotted` and `skinnable` in each skin, at the depth of
  the run: each piece of `VariantProps` draws its base, or the skin's variant
  given the base (which then differs from it); the example's card frames the
  base it gets.
- `variants.test.tsx`: the feature test of every variant, whoever writes it: in
  each skin, each piece it replaces at the depth of the run says everything its
  base says (every text a screen reader has, every link, every named list, every
  button), over the shapes an event takes (`EVENT_SHAPES`: rich, closed, no
  format, a single day, under way, a one-word name, next year); a ring says
  nothing, as its base. A skin's own tests use the same harness,
  `../test/variant.tsx`: `inApp` (a piece in the app: French, a day, a router,
  a skin, the frame of a page), `said` (what a screen reader has, never what is
  `aria-hidden`), `keepsEverything`, `EVENT_SHAPES`, `hex`; with the module of
  PocketBase made for it, `../test/pbMock.ts` (its first lines say how to mock
  `lib/pb` with it).
- `tokens.test.tsx`: in each skin, Crête's motifs and the map of a track take
  every colour from a `--motif-*` or `--map-*` property: none written out, in an
  attribute, a style or the arbitrary value of a class (`shadow-[…]`,
  `drop-shadow-[…]`; a mask's is only an alpha); a window, `--shade-dialog`; a
  toast, the white pill and the ring of the days left on a hero, their shades
  and veil; the titles, the style of `--display-*`. These pieces are checked at
  every depth: a rule of `mix.css` or `full.css` on the window of a dialog
  (`.dialog`), a message (`.toast`), the labels or the zoom of the map, or the
  titles, reads the property (a colour or a style written out there would fail
  them). The white pill is checked at palette only (`--shade-on-dawn`): at mix
  and full a skin may draw « S'inscrire » its own way.
- `smoke.test.tsx`: every skin × mode, at 320 px: home, an event with its map,
  profile and a dialog, a runner, the form, a public page (its card in
  `--shade-welcome`, `--welcome-card` and `--welcome-rim`), the settings, forced
  colours; 44 px targets, the marks of the titles, the current tab, the «+» and
  the main button in the skin's paint, ink and halo (the halo of `shadow-glow` in
  the skin, transparent too; at palette only, since mix and full may draw them
  their own way); at every depth, the current tab told apart from the others by
  more than the colour of its words (`toldApart`: its weight, a fill, a shadow,
  a border, a mark before or after it), and its words 4.5:1 on what is behind
  them (`textContrast` of `../test/computed.ts`: a fill that covers the tab, else
  what is under it; a bar cut out of the paint is not behind the words); what the heroes say whoever draws them (the end
  of the registrations, the notes, the link to register, the photo), the shades
  of the hero's pieces and the style of its title (at palette only, since mix
  and full may restyle them); the skins' sheets in the page, and what the
  skin's own sheet sets (`ownDeclaration` of
  `../test/computed.ts`: Crête declares every property, so the page alone would
  not say whether the skin set one).
- `../test/skinSheets.test.ts`: the forms a palette, a mix and a full sheet may
  and may not use (`sheetProblems`), and the stops a gradient may have.
- `../dark.test.ts`, `../contrast.test.ts`, `../dashed.test.ts`,
  `../features/route/slope.test.ts`: every skin × mode (`SKIN_CASES` of
  `../test/theme.ts`), the sky included, and the guards of the stylesheets
  (`dark.test.ts`: the three levels, and the `fonts.css` of every folder;
  `dashed.test.ts`: every dashed border or outline of a `mix.css` or `full.css`,
  `sheetDashes`, a state at 3:1 or a decoration of its list).
- `../fonts.test.ts`: the faces of every `fonts.css` (the package's files, its own
  declaration of each, each once), the families and weights each skin needs, and
  the faces of an italic or wider title (`--display-style`, `--display-stretch`).
- `../features/profile/ThemePicker.test.tsx`: the picker, its font samples, the
  edge of a swatch (3:1 on its card, in every skin and mode).
