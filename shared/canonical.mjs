// Canonical GitHub issue URL handling, shared by the importer, the claim
// processor (GitHub Actions), and the site. The canonical URL is the join key
// across every data file, so all three must agree on it.

const ISSUE_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)\/issues\/(\d+)(?:[/?#].*)?$/i;

/**
 * Parse any reasonable GitHub issue URL into its canonical form.
 * Accepts http/https, www., trailing slashes, query strings, fragments
 * (e.g. #issuecomment-123), and any casing. Rejects anything that is not an
 * /issues/<number> path (PRs, discussions, repo roots, non-GitHub hosts).
 *
 * @param {unknown} raw
 * @returns {{url: string, org: string, repo: string, number: number} | null}
 *   `url` is lowercased (the join key); `org`/`repo` keep the input casing
 *   for display.
 */
export function canonicalizeIssueUrl(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(ISSUE_URL_RE);
  if (!m) return null;
  const [, org, repo, num] = m;
  const number = Number(num);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return {
    url: `https://github.com/${org.toLowerCase()}/${repo.toLowerCase()}/issues/${number}`,
    org,
    repo,
    number,
  };
}

/**
 * Lowercased "org/repo" key for repo-level data files, from a canonical (or
 * canonicalizable) issue URL. Returns null if the URL does not parse.
 * @param {string} url
 */
export function repoKeyFromUrl(url) {
  const parsed = canonicalizeIssueUrl(url);
  return parsed ? `${parsed.org.toLowerCase()}/${parsed.repo.toLowerCase()}` : null;
}

const HYPERLINK_RE = /HYPERLINK\(\s*"([^"]+)"/i;

/**
 * Extract the URL argument from a `HYPERLINK("<url>", "<label>")` spreadsheet
 * formula. exceljs exposes formulas without the leading '='; a leading '=' is
 * tolerated anyway.
 * @param {unknown} formula
 * @returns {string | null}
 */
export function parseHyperlinkFormula(formula) {
  if (typeof formula !== 'string') return null;
  const m = formula.match(HYPERLINK_RE);
  return m ? m[1] : null;
}
