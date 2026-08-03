// The claims drain. Every run processes ALL open claim/unclaim tracker issues
// (never just the triggering event — GitHub concurrency can cancel queued
// runs, so the newest surviving run must pick up everything), applies the
// validation ladder and staff commands, mutates data/claims.json, and pushes
// one commit. Loop-safe by construction: comments/closes fire no subscribed
// events, and pushes with GITHUB_TOKEN trigger no workflows — deploys are
// chained explicitly by the workflow.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { canonicalizeIssueUrl, repoKeyFromUrl } from '../shared/canonical.mjs';
import {
  DUPLICATE_ACK_YES,
  FIELD_DUPLICATE_ACK,
  FIELD_ISSUE_URL,
  parseIssueFormBody,
} from '../shared/issue-form.mjs';
import { GitHub } from './lib/github.mjs';
import { commitAndPush } from './lib/git-commit.mjs';

export const LABELS = {
  CLAIM: 'claim',
  UNCLAIM: 'unclaim',
  PENDING: 'claim:pending',
  AWAITING: 'claim:awaiting-confirm',
  RECORDED: 'claim:recorded',
  INVALID: 'claim:invalid',
  NEEDS_STAFF: 'needs-staff',
};

const STAFF_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const COMMAND_RE = /^\s*\/(approve|deny|confirm)\b[ \t]*(.*)$/im;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)

export function labelNames(issue) {
  return new Set((issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)));
}

/**
 * Scan comments (chronological) for /approve, /deny, /confirm.
 * Staff candidates still need an isStaff() permission check by the caller.
 */
export function extractCommands(comments, actorLogin) {
  const candidates = [];
  let authorConfirmed = false;
  for (const c of comments ?? []) {
    const login = c.user?.login ?? '';
    if (login.endsWith('[bot]')) continue;
    const m = (c.body ?? '').match(COMMAND_RE);
    if (!m) continue;
    const type = m[1].toLowerCase();
    if (type === 'confirm') {
      if (login.toLowerCase() === actorLogin.toLowerCase()) authorConfirmed = true;
      continue;
    }
    candidates.push({
      type,
      author: login,
      reason: (m[2] ?? '').trim(),
      association: c.author_association ?? 'NONE',
    });
  }
  return { candidates, authorConfirmed };
}

export function findRecords(claimsDoc, url) {
  return claimsDoc.claims[url] ?? [];
}

export function findByClaimIssue(claimsDoc, issueNumber) {
  for (const [url, records] of Object.entries(claimsDoc.claims)) {
    const record = records.find((r) => r.claimIssue === issueNumber);
    if (record) return { url, record };
  }
  return null;
}

export function countUserClaims(claimsDoc, login) {
  let count = 0;
  for (const records of Object.values(claimsDoc.claims)) {
    count += records.filter((r) => r.claimedBy?.toLowerCase() === login.toLowerCase()).length;
  }
  return count;
}

export function listUserClaims(claimsDoc, login) {
  const urls = [];
  for (const [url, records] of Object.entries(claimsDoc.claims)) {
    if (records.some((r) => r.claimedBy?.toLowerCase() === login.toLowerCase())) urls.push(url);
  }
  return urls;
}

export function addRecord(claimsDoc, url, record) {
  (claimsDoc.claims[url] ??= []).push(record);
}

export function removeRecord(claimsDoc, url, predicate) {
  const records = claimsDoc.claims[url];
  if (!records) return false;
  const idx = records.findIndex(predicate);
  if (idx === -1) return false;
  records.splice(idx, 1);
  if (!records.length) delete claimsDoc.claims[url];
  return true;
}

export function hasFormAck(fields) {
  return (fields[FIELD_DUPLICATE_ACK] ?? '').trim() === DUPLICATE_ACK_YES;
}

// ---------------------------------------------------------------------------
// Comment copy

function policyLine(ctx, url) {
  const key = repoKeyFromUrl(url);
  const policy = ctx.policies[key];
  const src = policy?.sourceUrl ? `([source](${policy.sourceUrl}))` : '';
  switch (policy?.status) {
    case 'disallows':
      return `⚠️ **Our records say this repo rejects AI-assisted contributions** ${src}. Strongly consider a different issue — ask staff if unsure.`;
    case 'conditional':
      return `Note: this repo allows AI-assisted work **with conditions** ${src} — read their policy before starting.`;
    case 'allows':
      return `Good news: this repo explicitly allows AI-assisted contributions ${src}.`;
    default:
      return `We have **no verified AI-policy info** for this repo — unknown does *not* mean safe. Check its CONTRIBUTING guide before investing serious time.`;
  }
}

function confirmationComment(ctx, issue, url, { pending, assigned }) {
  const parsed = canonicalizeIssueUrl(url);
  const ref = `${parsed.org}/${parsed.repo}#${parsed.number}`;
  const contributing = `https://github.com/${repoKeyFromUrl(url)}/blob/HEAD/CONTRIBUTING.md`;
  return [
    `✅ @${issue.user.login} — your claim for **[${ref}](${url})** is recorded${
      pending ? ' and **pending staff review**. You can start working now; staff will approve or follow up here.' : '.'
    }`,
    '',
    '**Next steps**',
    `1. Read the repo's [CONTRIBUTING guide](${contributing}). ${policyLine(ctx, url)}`,
    `2. **[Introduce yourself on the issue](${url}) — in your own words.** Tell the maintainers who you are and how you plan to help. This tracker never posts anything upstream for you; the hand-written intro is part of the assignment.`,
    '3. The site shows your claim within ~3 minutes.',
    ...(assigned
      ? ['', '⚠️ Someone is already **assigned** to this issue upstream — maintainers may have it in progress. Check the issue thread before starting.']
      : []),
    '',
    `_Changed your mind? [Release it here](https://github.com/${ctx.owner}/${ctx.repo}/issues/new?template=unclaim.yml&issue_url=${encodeURIComponent(url)})._`,
  ].join('\n');
}

const duplicateWarning = (ctx, issue, url, claimants) =>
  [
    `⚠️ @${issue.user.login} — **[this issue](${url}) is already claimed by ${claimants}.**`,
    '',
    'Working the same issue as another student is discouraged: you risk duplicated effort and one of you not getting credit. This rule exists as a safety guard for you.',
    '',
    `If you understand and still want to proceed, reply here with \`/confirm\`. Otherwise you can simply close this issue and pick another — the [Issue Finder](https://github.com/${ctx.owner}/${ctx.repo}) has plenty.`,
  ].join('\n');

// ---------------------------------------------------------------------------
// Per-issue processing

async function resolveStaffCommand(ctx, candidates) {
  let latest = null;
  for (const c of candidates) {
    if (!STAFF_ASSOCIATIONS.has(c.association)) continue;
    if (!(await ctx.isStaff(c.author))) continue;
    latest = c; // chronological scan — last verified command wins
  }
  return latest;
}

async function processClaim(ctx, issue) {
  const labels = labelNames(issue);
  const actor = issue.user.login;
  const fields = parseIssueFormBody(issue.body);
  const comments = await ctx.api.listComments(issue.number);
  const { candidates, authorConfirmed } = extractCommands(comments, actor);
  const staffCmd = await resolveStaffCommand(ctx, candidates);
  const nonStaffCommand = candidates.find((c) => !STAFF_ASSOCIATIONS.has(c.association));

  // --- state: pending staff review -------------------------------------
  if (labels.has(LABELS.PENDING)) {
    const found = findByClaimIssue(ctx.claimsDoc, issue.number);
    if (!found) {
      await ctx.act.comment(issue.number, `This claim's record no longer exists (staff may have removed it). Closing.`);
      await ctx.act.close(issue.number, 'not_planned');
      return;
    }
    if (staffCmd?.type === 'deny') {
      removeRecord(ctx.claimsDoc, found.url, (r) => r.claimIssue === issue.number);
      ctx.markChanged(`denied #${issue.number}`);
      await ctx.act.comment(
        issue.number,
        `❌ Claim denied by @${staffCmd.author}${staffCmd.reason ? `: ${staffCmd.reason}` : '.'} The issue is released back to the pool — @${actor}, feel free to claim a different one.`,
      );
      await ctx.act.close(issue.number, 'not_planned');
    } else if (staffCmd?.type === 'approve') {
      found.record.status = 'active';
      found.record.decidedBy = staffCmd.author;
      found.record.decidedAt = ctx.now();
      ctx.markChanged(`approved #${issue.number}`);
      await ctx.act.comment(issue.number, `✅ Approved by @${staffCmd.author}. Happy contributing, @${actor}!`);
      await ctx.act.close(issue.number, 'completed');
    } else if (nonStaffCommand) {
      // Politely refuse once per non-staff commander (best-effort: comment every drain would spam — only comment if we haven't already)
      const REFUSAL_MARKER = 'Only course staff';
      const alreadyRefused = comments.some(
        (c) => c.user?.login?.endsWith('[bot]') && c.body?.includes(REFUSAL_MARKER),
      );
      if (!alreadyRefused) {
        await ctx.act.comment(
          issue.number,
          `${REFUSAL_MARKER} can \`/approve\` or \`/deny\` claims — this one stays pending until they review it.`,
        );
      }
    }
    return;
  }

  // --- state: awaiting duplicate confirmation --------------------------
  if (labels.has(LABELS.AWAITING)) {
    if (staffCmd?.type === 'deny') {
      await ctx.act.comment(
        issue.number,
        `Closed by @${staffCmd.author}${staffCmd.reason ? `: ${staffCmd.reason}` : '.'}`,
      );
      await ctx.act.close(issue.number, 'not_planned');
      return;
    }
    if (authorConfirmed || hasFormAck(fields)) {
      await freshClaim(ctx, issue, { fields, ack: true });
    }
    return;
  }

  // --- terminal states: retroactive staff /deny only --------------------
  if (labels.has(LABELS.RECORDED)) {
    if (staffCmd?.type === 'deny') {
      const found = findByClaimIssue(ctx.claimsDoc, issue.number);
      if (found) {
        removeRecord(ctx.claimsDoc, found.url, (r) => r.claimIssue === issue.number);
        ctx.markChanged(`denied #${issue.number}`);
        await ctx.act.comment(
          issue.number,
          `❌ This claim was retroactively denied by @${staffCmd.author}${staffCmd.reason ? `: ${staffCmd.reason}` : '.'} The issue is back in the pool.`,
        );
      }
    }
    return;
  }
  if (labels.has(LABELS.INVALID) || labels.has(LABELS.NEEDS_STAFF)) return;

  // --- fresh claim -------------------------------------------------------
  await freshClaim(ctx, issue, { fields, ack: hasFormAck(fields) || authorConfirmed });
}

async function freshClaim(ctx, issue, { fields, ack }) {
  const actor = issue.user.login;
  const parsed = canonicalizeIssueUrl(fields[FIELD_ISSUE_URL] ?? '');

  if (!parsed) {
    await ctx.act.comment(
      issue.number,
      `Sorry @${actor}, I couldn't find a valid GitHub **issue** URL in this form (it must look like \`https://github.com/org/repo/issues/123\`). Please open a fresh claim via the [Issue Finder](https://github.com/${ctx.owner}/${ctx.repo}).`,
    );
    await ctx.act.addLabels(issue.number, [LABELS.INVALID]);
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }
  const url = parsed.url;
  const ref = `${parsed.org}/${parsed.repo}#${parsed.number}`;

  if (ctx.blocklist.some((u) => u.toLowerCase() === actor.toLowerCase())) {
    await ctx.act.comment(issue.number, `This account isn't able to claim issues through the tracker. If you think that's a mistake, contact course staff.`);
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }

  if (!ctx.pool.has(url)) {
    await ctx.act.comment(
      issue.number,
      `**[${ref}](${url})** isn't in the AI 301 issue pool, so it can't be claimed here. Browse the pool on the [Issue Finder](https://github.com/${ctx.owner}/${ctx.repo}) — or ask in your section's issue-selection channel if you think it should be added.`,
    );
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }

  const records = findRecords(ctx.claimsDoc, url);
  if (records.some((r) => r.claimedBy?.toLowerCase() === actor.toLowerCase())) {
    await ctx.act.comment(issue.number, `You've already claimed **[${ref}](${url})** — you're all set, no need to claim again. 👍`);
    await ctx.act.addLabels(issue.number, [LABELS.RECORDED]);
    await ctx.act.close(issue.number, 'completed');
    return;
  }

  if (records.length && !ack) {
    const claimants = records
      .map((r) => (r.claimedBy ? `@${r.claimedBy}` : 'a student via the class sheet'))
      .join(', ');
    await ctx.act.comment(issue.number, duplicateWarning(ctx, issue, url, claimants));
    await ctx.act.addLabels(issue.number, [LABELS.AWAITING]);
    return; // stays open awaiting /confirm
  }

  const max = ctx.config.maxActiveClaimsPerUser ?? 1;
  if (countUserClaims(ctx.claimsDoc, actor) >= max) {
    const mine = listUserClaims(ctx.claimsDoc, actor)
      .map((u) => `- ${u}`)
      .join('\n');
    await ctx.act.comment(
      issue.number,
      [
        `You're at the limit of **${max} active claim${max === 1 ? '' : 's'}** per student. Your current claim${max === 1 ? '' : 's'}:`,
        mine,
        '',
        `Finish or release one first — [unclaim form](https://github.com/${ctx.owner}/${ctx.repo}/issues/new?template=unclaim.yml), then claim this one again.`,
      ].join('\n'),
    );
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }

  const live = await ctx.api.fetchIssueLive(url);
  if (live.state === 'closed') {
    await ctx.act.comment(issue.number, `**[${ref}](${url})** is already **closed** upstream, so there's nothing left to contribute there. Pick another issue — the site hides closed ones by default.`);
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }
  if (live.state === 'missing') {
    await ctx.act.comment(issue.number, `**[${ref}](${url})** isn't reachable anymore (the repo may have moved, been deleted, or gone private). Please pick another issue.`);
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }

  const pending = ctx.config.claimMode === 'review';
  addRecord(ctx.claimsDoc, url, {
    claimedBy: actor,
    claimedAt: ctx.now(),
    status: pending ? 'pending' : 'active',
    source: 'issue-form',
    claimIssue: issue.number,
  });
  ctx.markChanged(`recorded #${issue.number}`);
  await ctx.act.comment(issue.number, confirmationComment(ctx, issue, url, { pending, assigned: live.assigned }));
  if (pending) {
    await ctx.act.addLabels(issue.number, [LABELS.PENDING]);
  } else {
    await ctx.act.addLabels(issue.number, [LABELS.RECORDED]);
    await ctx.act.close(issue.number, 'completed');
  }
}

async function processUnclaim(ctx, issue) {
  const labels = labelNames(issue);
  if (labels.has(LABELS.NEEDS_STAFF)) return;
  const actor = issue.user.login;
  const fields = parseIssueFormBody(issue.body);
  const parsed = canonicalizeIssueUrl(fields[FIELD_ISSUE_URL] ?? '');
  if (!parsed) {
    await ctx.act.comment(issue.number, `Sorry @${actor}, I couldn't find a valid GitHub issue URL in this form.`);
    await ctx.act.addLabels(issue.number, [LABELS.INVALID]);
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }
  const url = parsed.url;
  const records = findRecords(ctx.claimsDoc, url);
  const mine = records.find((r) => r.claimedBy?.toLowerCase() === actor.toLowerCase());

  if (mine) {
    removeRecord(ctx.claimsDoc, url, (r) => r === mine);
    ctx.markChanged(`released #${issue.number}`);
    const finished = (fields['Why are you releasing it?'] ?? '').startsWith('Finished');
    await ctx.act.comment(
      issue.number,
      finished
        ? `🎉 Congrats on the merged PR, @${actor}! The claim is released and the pool is updated.`
        : `Done — your claim on **${url}** is released. Thanks for freeing it up for someone else, @${actor}.`,
    );
    await ctx.act.close(issue.number, 'completed');
    return;
  }
  if (records.some((r) => r.claimedBy === null)) {
    await ctx.act.comment(
      issue.number,
      `This issue's claim came from the **pre-tracker class sheet**, so there's no GitHub username attached and I can't verify it's yours. Course staff will take a look — if it *is* your claim, reply here with any context (e.g. a link to your PR) and they can attach your username or release it.`,
    );
    await ctx.act.addLabels(issue.number, [LABELS.NEEDS_STAFF]);
    return; // stays open for staff
  }
  if (records.length) {
    const claimants = records.map((r) => `@${r.claimedBy}`).join(', ');
    await ctx.act.comment(issue.number, `**${url}** is claimed by ${claimants}, not by you — only the claimant (or staff) can release it.`);
    await ctx.act.close(issue.number, 'not_planned');
    return;
  }
  await ctx.act.comment(issue.number, `**${url}** isn't currently claimed, so there's nothing to release. You're good!`);
  await ctx.act.close(issue.number, 'completed');
}

export async function processTrackerIssue(ctx, issue) {
  const labels = labelNames(issue);
  try {
    if (labels.has(LABELS.CLAIM)) await processClaim(ctx, issue);
    else if (labels.has(LABELS.UNCLAIM)) await processUnclaim(ctx, issue);
  } catch (err) {
    console.error(`error processing tracker #${issue.number}:`, err);
    ctx.failures.push(issue.number);
  }
}

// ---------------------------------------------------------------------------
// Driver

export function makeContext({ api, claimsDoc, pool, policies, blocklist, config, owner, repo, dryRun }) {
  const staffCache = new Map();
  const ctx = {
    api,
    claimsDoc,
    pool,
    policies,
    blocklist,
    config,
    owner,
    repo,
    dryRun,
    changed: [],
    failures: [],
    now: () => new Date().toISOString(),
    markChanged: (what) => ctx.changed.push(what),
    isStaff: async (login) => {
      if (!staffCache.has(login)) staffCache.set(login, await api.isStaff(login));
      return staffCache.get(login);
    },
    act: {
      comment: (n, body) =>
        dryRun ? console.log(`DRY comment #${n}:\n${body}\n`) : api.comment(n, body),
      addLabels: (n, labels) =>
        dryRun ? console.log(`DRY label #${n}: ${labels.join(', ')}`) : api.addLabels(n, labels),
      close: (n, reason) =>
        dryRun ? console.log(`DRY close #${n} as ${reason}`) : api.closeIssue(n, reason),
    },
  };
  return ctx;
}

async function main() {
  const dryRun = Boolean(process.env.DRY_RUN);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const config = JSON.parse(await readFile('data/config.json', 'utf8'));
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? `${config.trackerOwner}/${config.trackerRepo}`).split('/');
  const claimsDoc = JSON.parse(await readFile('data/claims.json', 'utf8'));
  const issuesDoc = JSON.parse(await readFile('data/issues.json', 'utf8'));
  const policies = JSON.parse(await readFile('data/ai-policies.json', 'utf8')).repos ?? {};
  const blocklist = JSON.parse(await readFile('data/blocklist.json', 'utf8'));
  const pool = new Set(issuesDoc.issues.map((i) => i.url));

  const api = new GitHub({ token, owner, repo });
  const ctx = makeContext({ api, claimsDoc, pool, policies, blocklist, config, owner, repo, dryRun });

  const open = [
    ...(await api.listOpenIssuesByLabel(LABELS.CLAIM)),
    ...(await api.listOpenIssuesByLabel(LABELS.UNCLAIM)),
  ].filter((i) => !i.pull_request);

  // Include the triggering issue even if closed (retroactive /deny on
  // auto-mode claims); the drain otherwise only sees open issues.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(await readFile(eventPath, 'utf8'));
      const num = event.issue?.number;
      if (num && !open.some((i) => i.number === num)) {
        const evIssue = await api.getIssue(num);
        const names = labelNames(evIssue);
        if (evIssue && (names.has(LABELS.CLAIM) || names.has(LABELS.UNCLAIM))) open.push(evIssue);
      }
    } catch (err) {
      console.warn('could not read event payload:', err.message);
    }
  }

  open.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  console.log(`processing ${open.length} tracker issue(s)${dryRun ? ' (dry run)' : ''}`);
  for (const issue of open) await processTrackerIssue(ctx, issue);

  let pushed = false;
  if (ctx.changed.length) {
    claimsDoc.updatedAt = ctx.now();
    if (!dryRun) {
      await writeFile('data/claims.json', JSON.stringify(claimsDoc, null, 1) + '\n');
    }
    const refs = ctx.changed.join(', ');
    pushed = commitAndPush({
      files: ['data/claims.json'],
      message: `claims: ${refs}`,
      dryRun,
    });
  }
  console.log(`done: ${ctx.changed.length} change(s), ${ctx.failures.length} failure(s)`);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${pushed}\n`);
  }
  if (ctx.failures.length) process.exitCode = 1;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
