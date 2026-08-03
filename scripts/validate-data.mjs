// Structural validation of every data/*.json file. Runs in CI and as a deploy
// gate: a malformed hand-edit (e.g. to ai-policies.json) fails the build and
// leaves the last good site live instead of shipping a broken data bundle.
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { canonicalizeIssueUrl } from '../shared/canonical.mjs';

const errors = [];
const fail = (msg) => errors.push(msg);

async function loadJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    fail(`${file}: unreadable or invalid JSON (${err.message})`);
    return null;
  }
}

const POLICY_STATUSES = new Set(['disallows', 'conditional', 'allows', 'unverified']);
const CLAIM_STATUSES = new Set(['pending', 'active']);
const CLAIM_SOURCES = new Set(['issue-form', 'sheet-import', 'staff']);
const ISSUE_STATES = new Set(['open', 'closed', 'missing']);

const issuesDoc = await loadJson('data/issues.json');
const issueUrls = new Set();
if (issuesDoc) {
  if (!Array.isArray(issuesDoc.issues)) fail('issues.json: .issues is not an array');
  else {
    if (issuesDoc.count !== issuesDoc.issues.length) {
      fail(`issues.json: count ${issuesDoc.count} != issues.length ${issuesDoc.issues.length}`);
    }
    issuesDoc.issues.forEach((issue, i) => {
      const where = `issues.json[${i}]`;
      if (!issue.title) fail(`${where}: missing title`);
      const parsed = canonicalizeIssueUrl(issue.url);
      if (!parsed) fail(`${where}: invalid url ${JSON.stringify(issue.url)}`);
      else if (parsed.url !== issue.url) fail(`${where}: url not canonical: ${issue.url}`);
      if (issueUrls.has(issue.url)) fail(`${where}: duplicate url ${issue.url}`);
      issueUrls.add(issue.url);
      if (!Array.isArray(issue.languages)) fail(`${where}: languages not an array`);
      if (!Array.isArray(issue.tags)) fail(`${where}: tags not an array`);
    });
  }
}

const claimsDoc = await loadJson('data/claims.json');
if (claimsDoc) {
  if (typeof claimsDoc.claims !== 'object' || claimsDoc.claims === null) {
    fail('claims.json: .claims is not an object');
  } else {
    for (const [url, records] of Object.entries(claimsDoc.claims)) {
      const where = `claims.json[${url}]`;
      const parsed = canonicalizeIssueUrl(url);
      if (!parsed || parsed.url !== url) fail(`${where}: key is not a canonical issue URL`);
      if (!Array.isArray(records) || records.length === 0) {
        fail(`${where}: value must be a non-empty array of claim records`);
        continue;
      }
      for (const rec of records) {
        if (rec.claimedBy !== null && typeof rec.claimedBy !== 'string') {
          fail(`${where}: claimedBy must be string or null`);
        }
        if (!CLAIM_STATUSES.has(rec.status)) fail(`${where}: bad status ${JSON.stringify(rec.status)}`);
        if (!CLAIM_SOURCES.has(rec.source)) fail(`${where}: bad source ${JSON.stringify(rec.source)}`);
        if (rec.claimedBy === null && rec.source === 'issue-form') {
          fail(`${where}: issue-form claims must have a username`);
        }
      }
      const users = records.filter((r) => r.claimedBy).map((r) => r.claimedBy.toLowerCase());
      if (new Set(users).size !== users.length) fail(`${where}: same user claims twice`);
    }
  }
}

const statusDoc = await loadJson('data/status.json');
if (statusDoc) {
  if (typeof statusDoc.statuses !== 'object' || statusDoc.statuses === null) {
    fail('status.json: .statuses is not an object');
  } else {
    for (const [url, st] of Object.entries(statusDoc.statuses)) {
      if (!ISSUE_STATES.has(st.state)) {
        fail(`status.json[${url}]: bad state ${JSON.stringify(st.state)}`);
      }
    }
  }
}

const policiesDoc = await loadJson('data/ai-policies.json');
if (policiesDoc) {
  if (typeof policiesDoc.repos !== 'object' || policiesDoc.repos === null) {
    fail('ai-policies.json: .repos is not an object');
  } else {
    for (const [repoKey, policy] of Object.entries(policiesDoc.repos)) {
      const where = `ai-policies.json[${repoKey}]`;
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoKey) || repoKey !== repoKey.toLowerCase()) {
        fail(`${where}: key must be lowercased "org/repo"`);
      }
      if (!POLICY_STATUSES.has(policy.status)) {
        fail(`${where}: bad status ${JSON.stringify(policy.status)}`);
      }
      if (policy.status !== 'unverified' && !policy.sourceUrl && !policy.note) {
        fail(`${where}: verified statuses need a sourceUrl or note (cite the evidence)`);
      }
    }
  }
}

const scanDoc = await loadJson('data/ai-policy-scan.json');
if (scanDoc && (typeof scanDoc.repos !== 'object' || scanDoc.repos === null)) {
  fail('ai-policy-scan.json: .repos is not an object');
}

const blocklist = await loadJson('data/blocklist.json');
if (blocklist && (!Array.isArray(blocklist) || blocklist.some((u) => typeof u !== 'string'))) {
  fail('blocklist.json: must be an array of usernames');
}

const config = await loadJson('data/config.json');
if (config) {
  if (!config.trackerOwner || !config.trackerRepo) fail('config.json: trackerOwner/trackerRepo required');
  if (!['review', 'auto'].includes(config.claimMode)) {
    fail(`config.json: claimMode must be "review" or "auto", got ${JSON.stringify(config.claimMode)}`);
  }
  if (!Number.isInteger(config.maxActiveClaimsPerUser) || config.maxActiveClaimsPerUser < 1) {
    fail('config.json: maxActiveClaimsPerUser must be a positive integer');
  }
}

if (errors.length) {
  console.error(`validate-data: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('validate-data: all data files OK');
