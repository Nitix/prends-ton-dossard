// The terrain of a race type, for a tint: asphalt for the road, forest for the
// trail, the high mountain for the ultra, mud for the cross, a lake for the
// backyard, steel for the hyrox. « Sentier » and « Alpage » (which imports this
// file) tint the formats of a card, and « Sentier » the band of a format on the
// page of an event, with it. The types are typed by the admins, so the terrain
// is read from the words of the label; a type that says none of them gets sand.
// The tint is decoration, the terrain a guess: the words of the format are written
// beside it (they hold the label of its type when the format has no name of its
// own, and no more than that), and the colours are the palette's (`full.css` gives
// each terrain its own).

export type Terrain = "route" | "trail" | "ultra" | "cross" | "backyard" | "hyrox" | "other";

/** A label in lower case and without accents, to be compared. */
const plain = (label: string) =>
  label.toLocaleLowerCase("fr").normalize("NFD").replaceAll(/\p{M}/gu, "");

// The first that the label has wins: an « Ultra-trail » is an ultra.
const KEYWORDS: readonly (readonly [Terrain, readonly string[]])[] = [
  ["ultra", ["ultra"]],
  ["backyard", ["backyard"]],
  ["hyrox", ["hyrox"]],
  ["cross", ["cross"]],
  ["trail", ["trail", "skyrace", "montagne", "mountain"]],
  ["route", ["route", "road", "marathon", "semi", "10 km", "piste", "track"]],
];

export function terrainOf(label: string): Terrain {
  const words = plain(label);
  return KEYWORDS.find(([, keys]) => keys.some((key) => words.includes(key)))?.[0] ?? "other";
}
