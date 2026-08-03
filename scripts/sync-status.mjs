// Daily sync of upstream issue state (open/closed/missing, stateReason,
// assignee presence, updatedAt) into data/status.json, via GraphQL
// resource(url:) lookups batched 100 aliases per query.
//
// Rate math: ~6.6k issues -> ~67 requests, ~2 points each ≈ 140 points
// against the 1,000 points/hour GITHUB_TOKEN GraphQL budget.
//
//   node scripts/sync-status.mjs           # full sync
//   DRY_RUN=1 LIMIT=200 node scripts/...   # first 200 URLs, no write/commit
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { GitHub } from './lib/github.mjs';
import { commitAndPush } from './lib/git-commit.mjs';

const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildBatchQuery(urls) {
  const parts = urls.map(
    (url, i) => `r${i}: resource(url: ${JSON.stringify(url)}) {
      __typename
      ... on Issue { state stateReason updatedAt assignees(first: 1) { totalCount } }
    }`,
  );
  return `query {\n${parts.join('\n')}\n}`;
}

export function statusFromNode(node) {
  if (!node || node.__typename !== 'Issue') {
    return { state: 'missing', stateReason: null, assigned: false, updatedAt: null };
  }
  return {
    state: node.state === 'OPEN' ? 'open' : 'closed',
    stateReason: node.stateReason ? node.stateReason.toLowerCase() : null,
    assigned: (node.assignees?.totalCount ?? 0) > 0,
    updatedAt: node.updatedAt ?? null,
  };
}

/** Diff ignoring generatedAt — a no-change day must not commit/redeploy. */
export function statusesEqual(a, b) {
  return JSON.stringify(a.statuses) === JSON.stringify(b.statuses);
}

async function main() {
  const dryRun = Boolean(process.env.DRY_RUN);
  const limit = Number(process.env.LIMIT) || Infinity;
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'MatthewOscar/Candidate-Issue-Tracker').split('/');
  const api = new GitHub({ token, owner, repo });

  const issuesDoc = JSON.parse(await readFile('data/issues.json', 'utf8'));
  const previous = JSON.parse(await readFile('data/status.json', 'utf8'));
  const urls = issuesDoc.issues.map((i) => i.url).slice(0, limit);

  const statuses = {};
  let missing = 0;
  for (let start = 0; start < urls.length; start += BATCH_SIZE) {
    const batch = urls.slice(start, start + BATCH_SIZE);
    const data = await api.graphql(buildBatchQuery(batch), {});
    batch.forEach((url, i) => {
      const status = statusFromNode(data?.[`r${i}`]);
      if (status.state === 'missing') missing++;
      statuses[url] = status;
    });
    console.log(`synced ${Math.min(start + BATCH_SIZE, urls.length)}/${urls.length}`);
    if (start + BATCH_SIZE < urls.length) await sleep(BATCH_PAUSE_MS);
  }

  const next = { generatedAt: new Date().toISOString(), statuses };
  const open = Object.values(statuses).filter((s) => s.state === 'open').length;
  const closed = Object.values(statuses).filter((s) => s.state === 'closed').length;
  let diff = 0;
  for (const [url, status] of Object.entries(statuses)) {
    if (JSON.stringify(previous.statuses?.[url]) !== JSON.stringify(status)) diff++;
  }
  console.log(`open: ${open}, closed: ${closed}, missing: ${missing}, changed vs previous: ${diff}`);

  let pushed = false;
  if (limit !== Infinity) {
    console.log('LIMIT set — treating as a probe run, not writing status.json');
  } else if (statusesEqual(previous, next)) {
    console.log('no changes — skipping commit');
  } else {
    if (!dryRun) await writeFile('data/status.json', JSON.stringify(next, null, 1) + '\n');
    pushed = commitAndPush({
      files: ['data/status.json'],
      message: `status: daily sync (${diff} changed, ${closed} closed, ${missing} missing)`,
      dryRun,
    });
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${pushed}\n`);
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
