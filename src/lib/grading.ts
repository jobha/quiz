// Loose match for free-text answers: case/whitespace/punctuation insensitive.
export function autoGrade(submitted: string, correct: string): boolean {
  return normalize(submitted) === normalize(correct);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks (diacritics)
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
