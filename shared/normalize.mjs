// Normalization for the semicolon-delimited list columns in the source sheet.
// Tags arrive in many spellings ("Good First Issue", "good-first-issue",
// "good_first_issue"...) and must collapse to one filterable value.

/**
 * Split a sheet cell like "Python;Makefile" into trimmed, non-empty parts.
 * @param {unknown} value
 * @returns {string[]}
 */
export function splitList(value) {
  if (value == null) return [];
  return String(value)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Canonical form of an issue tag: lowercase, hyphens/underscores as spaces,
 * whitespace collapsed.
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTag(tag) {
  return String(tag)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a list of raw tags, deduplicating post-normalization while
 * preserving first-seen order.
 * @param {string[]} rawTags
 * @returns {string[]}
 */
export function normalizeTags(rawTags) {
  const seen = new Set();
  const out = [];
  for (const raw of rawTags) {
    const norm = normalizeTag(raw);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
