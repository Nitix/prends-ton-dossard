/** The first character of a word, which may take more than one UTF-16 unit. */
function firstLetter(word: string | undefined): string {
  return Array.from(word ?? "")[0] ?? "";
}

/** "AM" for "Alice Martin", "B" for "Bob": the first letter of the first and of the last word. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  const last = words.length > 1 ? firstLetter(words.at(-1)) : "";
  return (firstLetter(words[0]) + last).toLocaleUpperCase();
}
