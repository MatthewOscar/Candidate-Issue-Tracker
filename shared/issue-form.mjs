// Parser for GitHub Issue Form submissions. GitHub renders a form as
// markdown: each field becomes "### <Field label>" followed by the value,
// with "_No response_" for empty optional fields. The claim processor reads
// fields by their rendered heading, so the heading constants here must match
// the `label:` values in .github/ISSUE_TEMPLATE/*.yml.

export const FIELD_ISSUE_URL = 'Issue URL';
export const FIELD_DUPLICATE_ACK = 'Is someone already working on this?';
export const DUPLICATE_ACK_YES =
  'Yes — I understand working a claimed issue is discouraged and want to proceed';

const NO_RESPONSE = '_No response_';

/**
 * Parse an issue-form body into a { [fieldLabel]: value } map. Values are
 * trimmed; "_No response_" becomes ''. Returns an empty object for bodies
 * that contain no "### " headings (e.g. hand-written issues).
 * @param {unknown} body
 * @returns {Record<string, string>}
 */
export function parseIssueFormBody(body) {
  if (typeof body !== 'string') return {};
  const fields = {};
  // Normalize line endings; GitHub bodies use \r\n.
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let currentLabel = null;
  let buffer = [];
  const flush = () => {
    if (currentLabel === null) return;
    let value = buffer.join('\n').trim();
    if (value === NO_RESPONSE) value = '';
    fields[currentLabel] = value;
  };
  for (const line of lines) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      flush();
      currentLabel = heading[1];
      buffer = [];
    } else if (currentLabel !== null) {
      buffer.push(line);
    }
  }
  flush();
  return fields;
}
