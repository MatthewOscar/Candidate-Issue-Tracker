// Imports the AI 301 issue-candidate spreadsheet into data/issues.json and
// (optionally, first run only) seeds data/claims.json from its Claimed?
// column. Accepts a local .xlsx path or an https URL — e.g. a Google Sheets
// `/export?format=xlsx` link — so the refresh-pool workflow can pull the
// staff sheet directly.
//
//   node scripts/import-xlsx.mjs --in <path-or-url> [--sheet Issues]
//     [--out data/issues.json] [--claims data/claims.json] [--seed-claims]
//     [--prune-orphan-claims] [--dry-run]
//     [--expect rows=6917,unique=6647,dupes=270,claimed=1633,unclaimed=5284,rejects=0]
//
// Refresh semantics: issues.json is rewritten wholesale; claims.json is never
// modified except by --seed-claims (only when absent/empty) or
// --prune-orphan-claims (explicit staff opt-in). Exits non-zero when the
// structural gate or any --expect assertion fails, before writing anything.
import { parseArgs } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import ExcelJS from 'exceljs';
import { canonicalizeIssueUrl, parseHyperlinkFormula } from '../shared/canonical.mjs';
import { normalizeTags, splitList } from '../shared/normalize.mjs';

const HEADER_ROW = 4; // "Issue Title" | "Repository Name" | ... per the sheet
const FIRST_DATA_ROW = 5;
const COL = { title: 2, repo: 3, org: 4, languages: 5, tags: 6, link: 7, claimed: 8 };

// A healthy export has ~100% URL coverage; anything below this means the
// sheet's shape changed and the import must not silently gut the pool.
const MIN_URL_COVERAGE = 0.9;

/** Extract the issue URL from a link cell in any of its known shapes. */
export function extractUrlFromLinkCell(cell) {
  const value = cell?.value;
  if (value == null) return null;
  // Formula cell: { formula: 'HYPERLINK("https://...", "GitHub")', result: 'GitHub' }
  if (typeof value === 'object' && 'formula' in value && value.formula) {
    const url = parseHyperlinkFormula(value.formula);
    if (url) return url;
  }
  // Real hyperlink object: { text: 'GitHub', hyperlink: 'https://...' }
  if (typeof value === 'object' && 'hyperlink' in value && value.hyperlink) {
    return String(value.hyperlink);
  }
  // Plain text that happens to be a URL.
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text;
  }
  return null;
}

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((p) => p.text ?? '').join('');
    }
    if ('text' in v) return String(v.text ?? '');
    if ('result' in v) return String(v.result ?? '');
  }
  return String(v);
}

function cellBool(cell) {
  const v = cell?.value;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().toUpperCase() === 'TRUE';
  if (typeof v === 'number') return v !== 0;
  return false;
}

/**
 * Read the issue pool out of a loaded workbook. Pure with respect to the
 * filesystem so tests can feed synthetic workbooks.
 */
export function importWorkbook(workbook, sheetName) {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) {
    const names = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(`sheet "${sheetName}" not found (workbook has: ${names})`);
  }

  const rejects = [];
  const byUrl = new Map();
  let rowsRead = 0;
  let rowClaimed = 0;
  let duplicates = 0;

  for (let r = FIRST_DATA_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const title = cellText(row.getCell(COL.title)).trim();
    if (!title) continue; // blank / footer rows
    rowsRead++;

    const claimed = cellBool(row.getCell(COL.claimed));
    if (claimed) rowClaimed++;

    const rawUrl = extractUrlFromLinkCell(row.getCell(COL.link));
    const parsed = canonicalizeIssueUrl(rawUrl);
    if (!parsed) {
      rejects.push({ row: r, title, reason: `no valid GitHub issue URL (got: ${JSON.stringify(rawUrl)})` });
      continue;
    }

    const sheetOrg = cellText(row.getCell(COL.org)).trim();
    const sheetRepo = cellText(row.getCell(COL.repo)).trim();
    if (sheetOrg && sheetOrg.toLowerCase() !== parsed.org.toLowerCase()) {
      console.warn(`  warn row ${r}: sheet org "${sheetOrg}" != URL org "${parsed.org}"`);
    }
    if (sheetRepo && sheetRepo.toLowerCase() !== parsed.repo.toLowerCase()) {
      console.warn(`  warn row ${r}: sheet repo "${sheetRepo}" != URL repo "${parsed.repo}"`);
    }

    const rawTags = splitList(cellText(row.getCell(COL.tags)));
    const issue = {
      url: parsed.url,
      title,
      org: parsed.org,
      repo: parsed.repo,
      number: parsed.number,
      languages: [...new Set(splitList(cellText(row.getCell(COL.languages))))],
      tags: normalizeTags(rawTags),
      rawTags,
      claimedInSheet: claimed,
    };

    const existing = byUrl.get(parsed.url);
    if (existing) {
      duplicates++;
      // Keep the claimed variant so a claim recorded on any duplicate row survives.
      if (claimed && !existing.claimedInSheet) byUrl.set(parsed.url, issue);
    } else {
      byUrl.set(parsed.url, issue);
    }
  }

  const issues = [...byUrl.values()];
  return {
    issues,
    report: {
      rowsRead,
      rejects,
      duplicates,
      unique: issues.length,
      rowClaimed,
      rowUnclaimed: rowsRead - rowClaimed,
      postDedupeClaimed: issues.filter((i) => i.claimedInSheet).length,
    },
  };
}

function structuralGate(report) {
  const problems = [];
  if (report.rowsRead === 0) problems.push('no data rows found');
  if (report.unique === 0) problems.push('no issues with valid URLs found');
  const coverage = report.rowsRead ? (report.rowsRead - report.rejects.length) / report.rowsRead : 0;
  if (coverage < MIN_URL_COVERAGE) {
    problems.push(`URL coverage ${(coverage * 100).toFixed(1)}% below ${MIN_URL_COVERAGE * 100}%`);
  }
  return problems;
}

function checkExpectations(expectSpec, report) {
  if (!expectSpec) return [];
  const actual = {
    rows: report.rowsRead,
    unique: report.unique,
    dupes: report.duplicates,
    claimed: report.rowClaimed,
    unclaimed: report.rowUnclaimed,
    rejects: report.rejects.length,
  };
  const failures = [];
  for (const pair of expectSpec.split(',')) {
    const [key, valueStr] = pair.split('=').map((s) => s.trim());
    if (!(key in actual)) {
      failures.push(`unknown --expect key "${key}" (valid: ${Object.keys(actual).join(', ')})`);
      continue;
    }
    const expected = Number(valueStr);
    if (actual[key] !== expected) {
      failures.push(`expected ${key}=${expected}, got ${actual[key]}`);
    }
  }
  return failures;
}

async function resolveInput(input) {
  if (/^https?:\/\//i.test(input)) {
    console.log(`downloading ${input} ...`);
    const res = await fetch(input, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = await mkdtemp(path.join(tmpdir(), 'ai301-import-'));
    const file = path.join(dir, 'sheet.xlsx');
    await writeFile(file, buf);
    console.log(`downloaded ${(buf.length / 1024).toFixed(0)} KiB`);
    return file;
  }
  return input;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      in: { type: 'string' },
      sheet: { type: 'string', default: 'Issues' },
      out: { type: 'string', default: 'data/issues.json' },
      claims: { type: 'string', default: 'data/claims.json' },
      'seed-claims': { type: 'boolean', default: false },
      'prune-orphan-claims': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      expect: { type: 'string' },
    },
  });
  if (!args.in) {
    console.error('usage: node scripts/import-xlsx.mjs --in <path-or-url> [options]');
    process.exit(2);
  }

  const file = await resolveInput(args.in);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const { issues, report } = importWorkbook(workbook, args.sheet);

  console.log('--- reconciliation report ---');
  console.log(`rows read:            ${report.rowsRead}`);
  console.log(`url rejects:          ${report.rejects.length}`);
  for (const rej of report.rejects) console.log(`  row ${rej.row}: ${rej.reason}`);
  console.log(`duplicate URLs:       ${report.duplicates}`);
  console.log(`unique issues:        ${report.unique}`);
  console.log(`claimed (rows):       ${report.rowClaimed}`);
  console.log(`unclaimed (rows):     ${report.rowUnclaimed}`);
  console.log(`claimed (post-dedupe):${report.postDedupeClaimed}`);

  const problems = [...structuralGate(report), ...checkExpectations(args.expect, report)];
  if (problems.length) {
    console.error('\nIMPORT GATE FAILED — nothing written:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // Orphan report: existing claims whose issue left the pool.
  let claimsDoc = null;
  let orphans = [];
  if (existsSync(args.claims)) {
    claimsDoc = JSON.parse(await readFile(args.claims, 'utf8'));
    const pool = new Set(issues.map((i) => i.url));
    orphans = Object.keys(claimsDoc.claims ?? {}).filter((url) => !pool.has(url));
    if (orphans.length) {
      console.log(`\norphaned claims (issue no longer in pool): ${orphans.length}`);
      for (const url of orphans) console.log(`  ${url}`);
      if (!args['prune-orphan-claims']) {
        console.log('  (kept — pass --prune-orphan-claims to remove them)');
      }
    }
  }

  if (args['dry-run']) {
    console.log('\ndry run — no files written');
    return;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sourceFile: /^https?:/i.test(args.in) ? 'google-sheet-export' : path.basename(args.in),
    count: issues.length,
    issues,
  };
  await writeFile(args.out, JSON.stringify(out, null, 1) + '\n');
  console.log(`\nwrote ${args.out} (${issues.length} issues)`);

  const claimsEmpty =
    !claimsDoc || !claimsDoc.claims || Object.keys(claimsDoc.claims).length === 0;
  if (args['seed-claims']) {
    if (!claimsEmpty) {
      console.log(`${args.claims} already has claims — seeding skipped (never overwrites)`);
    } else {
      const claims = {};
      for (const issue of issues) {
        if (issue.claimedInSheet) {
          claims[issue.url] = [
            {
              claimedBy: null,
              claimedAt: null,
              status: 'active',
              source: 'sheet-import',
              claimIssue: null,
            },
          ];
        }
      }
      await writeFile(
        args.claims,
        JSON.stringify({ updatedAt: new Date().toISOString(), claims }, null, 1) + '\n',
      );
      console.log(`seeded ${args.claims} with ${Object.keys(claims).length} sheet-imported claims`);
    }
  }

  if (args['prune-orphan-claims'] && claimsDoc && orphans.length) {
    for (const url of orphans) delete claimsDoc.claims[url];
    claimsDoc.updatedAt = new Date().toISOString();
    await writeFile(args.claims, JSON.stringify(claimsDoc, null, 1) + '\n');
    console.log(`pruned ${orphans.length} orphaned claims from ${args.claims}`);
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
