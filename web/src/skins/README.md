# Skins

A skin dresses the app; it never changes what the app does. Each one is a folder
of this one, found by `import.meta.glob("./*/index.ts")` in `index.ts`: adding a
skin is adding a folder, no shared file is edited. « Crête » (`crete/`) is the
default: `styles.css` draws it, and a page without `data-skin` on `<html>` is in it.

The skin is chosen in Réglages → Apparence → « Thème », kept on the device
(`localStorage["ptd-skin"]`, nothing for Crête) and put on `<html data-skin="<id>">`,
by the script of `index.html` before the page is first drawn, then by `applySkin`.

## The folder of a skin

```
skins/<id>/
  index.ts     the skin (required): `export const skin: Skin`
  palette.css  its colours, fonts and motifs in CSS (depth palette)
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
};
```

A folder whose name starts with `_` is a skin of development (`_example/`): the
dev server and the tests have it, in the picker too; a build has nothing of it
(`plugin.ts` makes each of its files an empty module there, the registry leaves
it out, and the table of `index.html` does not name it).

## Adding a skin, step by step

1. Create `skins/<id>/index.ts` as above. `modes` is read by the build too
   (`plugin.ts`), so keep it a literal array.
2. Write `palette.css` (see Colours). Every rule starts with `:root[data-skin="<id>"]`.
3. Draw its motifs as components of the slots it changes, and list them in `slots`.
4. Run `pnpm --dir web test`: the contrast tests (`dark`, `contrast`, `dashed`,
   `slope`), the registry, the table of `index.html` and the smoke test of the pages
   now go through the new skin in each of its modes.
5. Deeper: `mix.css`, `full.css`, and `mix.tsx` / `full.tsx` for markup variants.

## Colours (palette.css)

A skin sets the custom properties that `styles.css` declares for Crête (`@theme`
and `:root`): `--color-neutral-*`, `--color-ink`, `--color-iris-*` (the accent),
`--color-peach-*`, `--color-blush-*`, `--color-red-*`, `--color-card`,
`--color-raised`, `--color-field`, `--color-rim`, `--color-toast`, `--color-scrim`,
`--color-relief`, `--color-slope-1…5`, `--font-sans`, `--font-display`,
`--radius-*`, `--shadow-*`, `--shade-*`, `--map-frame`, `--map-veil`,
`--sheet-glow`. It sets no other (a test says so). What it does not set stays
Crête's, in the mode the page is drawn in.

```css
:root[data-skin="<id>"] {
  --color-neutral-50: #…;
  --color-ink: #…;
  --color-iris-600: #…;
}
```

The pieces that `styles.css` paints in fixed colours are repainted by class:
`.bg-dawn-deep` (the pills that carry white text: every stop 4.5:1 with white),
`.bg-dawn` (the soft one, dark text), `.bg-dawn-sky` (the header and the sign-in
page), `.bg-dawn-hero` (the heroes), `.text-dawn`, `.page-title::after` (the line
under a title), and the focus ring on the sky (`.on-dawn :focus-visible`).

```css
:root[data-skin="<id>"] .bg-dawn-deep {
  background-image: linear-gradient(110deg, #… 0%, #… 50%, #… 100%);
}
```

The rules of a skin are outside the cascade layers, so they win over `@theme`
(layer `theme`), the dark blocks of Crête (layer `base`) and the utilities (layer
`utilities`), whatever the order of the stylesheets.

### Dark mode

- One mode only: the page is always drawn in it (`data-theme` is set to it by
  `lib/theme.ts` and by `index.html`, whatever « Clair / Sombre / Auto » says),
  and the picker hides those three. A dark-only skin sets its night colours under
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
colours as they are; a skin whose sky keeps its day colours at night puts them
back the same way, every colour its night changes:

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
elevation profile; those rules hold under every skin. A skin that paints a meaning
with a background of its own (a chip, a current item) adds its edge under
`@media (forced-colors: active)`, scoped to `:root[data-skin="<id>"]`.

### Fonts

`--font-sans` and `--font-display` name its families; their files are served by
the site and loaded only when the skin is used (Task 2 of v6). `fontSample` is
the family the picker draws « Aa » in, once loaded: the picker never loads a font.

## Slots (motifs)

The motifs are components in named places of the app (`types.ts`, `Slots`). The
app asks for them with `useSlot(name)`, which gives the skin's own or Crête's:

| Slot            | Props                                  | Where                                                          |
| --------------- | -------------------------------------- | -------------------------------------------------------------- |
| `HeaderArt`     | `place: "header" \| "welcome"`, `sun?` | the sky of the header (AppShell), the sign-in pages (\_\_root) |
| `BrandMark`     | `size?: "md" \| "lg"`                  | the name of the app after its mark, on the sky                 |
| `HeroArt`       | `place: "event" \| "runner"`           | behind the hero of an event, of a runner                       |
| `Divider`       | `className?`                           | between two blocks of the home page                            |
| `SectionMarker` | none                                   | the first child of every `h2.section-title`                    |
| `EmptyArt`      | none                                   | over the words of an empty list (EmptyState)                   |

A motif is decoration: `aria-hidden="true"`, `focusable="false"` on an SVG,
nothing that the words around it do not say. Crête's long paths are in the page
once (`MotifDefs`, in `crete/Alpenglow.tsx`); a skin draws its own.

## Semantic classes (mix and full)

The signature pieces carry a class of their own beside their Tailwind classes,
for a deeper skin to restyle them. Crête draws them with the Tailwind classes; the
semantic classes carry no style of Crête but `.page-title` and `.block-title`.

| Class                                                           | Element                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `.app-header`                                                   | the header of a signed-in page, on the sky                  |
| `.tabbar`, `.tab`                                               | the bar of the tabs (`nav`), each tab (`a`, `aria-current`) |
| `.fab`                                                          | the floating « + » that creates an event                    |
| `.event-card`                                                   | an event in a list                                          |
| `.event-hero`, `.runner-hero`                                   | the top of the page of an event, of a runner                |
| `.page-title`                                                   | the `h1` of a page (with its line, `::after`)               |
| `.section-title`                                                | the `h2` of a block (also `.block-title`)                   |
| `.stat-tile`                                                    | a figure of a track (km, D+, D−), a total of the stats      |
| `.chip`, `.date-chip`                                           | a runner on an event card, the day of an event              |
| `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-on-dawn` | the buttons (`components/buttons.ts`)                       |
| `.card`, `.month-title`, `.eyebrow`, `.sheet`                   | already in `styles.css`                                     |

```css
/* mix.css */
:root[data-skin="<id>"] .event-card {
  border-radius: 0.375rem;
}
```

## Depth (`VITE_SKIN_DEPTH`)

`palette` (default), `mix` or `full`, read at build time by `plugin.ts`, which
fails the build on any other value. It is a constant of the build:
`SKIN_DEPTH` in `index.ts` (`BUILD_SKIN_DEPTH`). The plugin points the module
`virtual:skin-depth` at `depth/<depth>.ts`, whose `import.meta.glob` calls take
the files of that level and of the ones before it, in order (a deeper sheet wins):

| Depth     | Stylesheets                          | Variants              |
| --------- | ------------------------------------ | --------------------- |
| `palette` | `palette.css`                        | none                  |
| `mix`     | `palette.css`, `mix.css`             | `mix.tsx`             |
| `full`    | `palette.css`, `mix.css`, `full.css` | `mix.tsx`, `full.tsx` |

The files of a deeper level are not in the build at all. Tokens belong in
`palette.css`: `mix.css` and `full.css` restyle pieces with them.

### Markup variants

A piece whose markup must change (the bib of « Dossard », the ticket of
« Rétro ») asks for its variant by name, with itself as the fallback:

```tsx
const Card = useSkinVariant("EventCard", EventCardBase);
return <Card view={view} />;
```

The skin exports the variant from `mix.tsx` or `full.tsx` (full wins over mix);
it takes the props of the component it replaces:

```tsx
export const variants: Variants = { EventCard: BibCard };
```

## Tests

- `index.test.ts`: the registry, the choice (kept, applied, refused storage,
  other tabs), the mode of a single-mode skin, the slots' fallback, the variants.
- `plugin.test.ts`, `noFlash.test.ts`: the depth, the files of each depth, the
  table of the skins written in `index.html` and its script before the first paint.
- `smoke.test.tsx`: the main pages drawn in each skin at 375 px.
- `../dark.test.ts`, `../contrast.test.ts`, `../dashed.test.ts`,
  `../features/route/slope.test.ts`: every skin × mode (`SKIN_CASES` of
  `../test/theme.ts`).
- `../features/profile/ThemePicker.test.tsx`: the picker.
