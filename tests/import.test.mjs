import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractUrlFromLinkCell, importWorkbook } from '../scripts/import-xlsx.mjs';

// Builds a workbook shaped like the real export: junk in rows 1-3, header in
// row 4, data from row 5, HYPERLINK formulas in the link column.
function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Issues');
  ws.getCell('B2').value = 'announcement text';
  const header = ['Issue Title', 'Repository Name', 'Organization Name', 'Repository Languages', 'Issue Tags', 'Issue Link', 'Claimed?'];
  header.forEach((h, i) => (ws.getRow(4).getCell(2 + i).value = h));
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.getCell(2).value = r.title;
    row.getCell(3).value = r.repo ?? 'repo';
    row.getCell(4).value = r.org ?? 'org';
    row.getCell(5).value = r.languages ?? 'Python';
    row.getCell(6).value = r.tags ?? 'good first issue';
    row.getCell(7).value = r.link;
    row.getCell(8).value = r.claimed ?? false;
  });
  return wb;
}

const formulaLink = (url) => ({
  formula: `HYPERLINK("${url}", "GitHub")`,
  result: 'GitHub',
});

describe('extractUrlFromLinkCell', () => {
  it('reads formula cells', () => {
    expect(
      extractUrlFromLinkCell({ value: formulaLink('https://github.com/a/b/issues/1') }),
    ).toBe('https://github.com/a/b/issues/1');
  });
  it('reads hyperlink-object cells', () => {
    expect(
      extractUrlFromLinkCell({
        value: { text: 'GitHub', hyperlink: 'https://github.com/a/b/issues/2' },
      }),
    ).toBe('https://github.com/a/b/issues/2');
  });
  it('reads plain-string cells', () => {
    expect(extractUrlFromLinkCell({ value: 'https://github.com/a/b/issues/3' })).toBe(
      'https://github.com/a/b/issues/3',
    );
  });
  it('returns null for empty cells', () => {
    expect(extractUrlFromLinkCell({ value: null })).toBeNull();
  });
});

describe('importWorkbook', () => {
  it('imports, normalizes, and counts', () => {
    const wb = buildWorkbook([
      {
        title: 'Fix the thing',
        org: 'pytorch',
        repo: 'pytorch',
        tags: 'Good First Issue;help-wanted',
        languages: 'Python;C++;Python',
        link: formulaLink('https://github.com/pytorch/pytorch/issues/1'),
        claimed: true,
      },
      {
        title: 'Docs issue',
        link: { text: 'GitHub', hyperlink: 'https://github.com/a/b/issues/2' },
      },
    ]);
    const { issues, report } = importWorkbook(wb, 'Issues');
    expect(report.rowsRead).toBe(2);
    expect(report.unique).toBe(2);
    expect(report.rejects).toHaveLength(0);
    expect(report.rowClaimed).toBe(1);
    expect(report.rowUnclaimed).toBe(1);
    const [first] = issues;
    expect(first.tags).toEqual(['good first issue', 'help wanted']);
    expect(first.rawTags).toEqual(['Good First Issue', 'help-wanted']);
    expect(first.languages).toEqual(['Python', 'C++']);
    expect(first.claimedInSheet).toBe(true);
    expect(first.number).toBe(1);
  });

  it('dedupes by URL, preferring the claimed row', () => {
    const wb = buildWorkbook([
      { title: 'dup A', link: formulaLink('https://github.com/a/b/issues/7'), claimed: false },
      { title: 'dup B', link: formulaLink('https://github.com/A/B/issues/7/'), claimed: true },
      { title: 'other', link: formulaLink('https://github.com/a/b/issues/8'), claimed: false },
    ]);
    const { issues, report } = importWorkbook(wb, 'Issues');
    expect(report.duplicates).toBe(1);
    expect(report.unique).toBe(2);
    const dup = issues.find((i) => i.url === 'https://github.com/a/b/issues/7');
    expect(dup?.claimedInSheet).toBe(true);
    expect(dup?.title).toBe('dup B');
  });

  it('rejects rows without a parseable issue URL', () => {
    const wb = buildWorkbook([
      { title: 'bad link', link: 'GitHub' },
      { title: 'pr link', link: formulaLink('https://github.com/a/b/pull/9') },
      { title: 'fine', link: formulaLink('https://github.com/a/b/issues/9') },
    ]);
    const { report } = importWorkbook(wb, 'Issues');
    expect(report.rejects).toHaveLength(2);
    expect(report.unique).toBe(1);
    expect(report.rejects[0].row).toBe(5);
  });

  it('throws on a missing sheet', () => {
    const wb = buildWorkbook([]);
    expect(() => importWorkbook(wb, 'Nope')).toThrow(/not found/);
  });
});
