import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractCommands,
  countUserClaims,
  findByClaimIssue,
  LABELS,
  makeContext,
  processTrackerIssue,
  removeRecord,
} from '../scripts/process-claims.mjs';

// ---------------------------------------------------------------------------
// Fake GitHub API that records mutations.

function fakeApi({ comments = {}, staff = [], live = {} } = {}) {
  const calls = { comments: [], labels: [], closes: [] };
  return {
    calls,
    listComments: async (n) => comments[n] ?? [],
    comment: async (n, body) => calls.comments.push({ n, body }),
    addLabels: async (n, labels) => calls.labels.push({ n, labels }),
    closeIssue: async (n, reason) => calls.closes.push({ n, reason }),
    isStaff: async (login) => staff.includes(login),
    fetchIssueLive: async (url) => live[url] ?? { state: 'open', assigned: false },
  };
}

const POOL_URL = 'https://github.com/pytorch/pytorch/issues/1';
const POOL_URL_2 = 'https://github.com/pytorch/pytorch/issues/2';

function claimIssue({
  number = 10,
  user = 'student1',
  url = POOL_URL,
  labels = [LABELS.CLAIM],
  ack = false,
} = {}) {
  return {
    number,
    user: { login: user },
    labels: labels.map((name) => ({ name })),
    created_at: '2026-08-01T00:00:00Z',
    body: [
      '### Issue URL',
      '',
      url,
      '',
      '### Is someone already working on this?',
      '',
      ack ? 'Yes — I understand working a claimed issue is discouraged and want to proceed' : 'No',
    ].join('\n'),
  };
}

function unclaimIssue({ number = 20, user = 'student1', url = POOL_URL } = {}) {
  return {
    number,
    user: { login: user },
    labels: [{ name: LABELS.UNCLAIM }],
    created_at: '2026-08-01T00:00:00Z',
    body: `### Issue URL\n\n${url}\n\n### Why are you releasing it?\n\nFinished — my PR was merged 🎉`,
  };
}

function makeCtx(api, overrides = {}) {
  return makeContext({
    api,
    claimsDoc: { updatedAt: null, claims: {} },
    pool: new Set([POOL_URL, POOL_URL_2]),
    policies: {},
    blocklist: [],
    config: { claimMode: 'review', maxActiveClaimsPerUser: 1 },
    owner: 'MatthewOscar',
    repo: 'Candidate-Issue-Tracker',
    dryRun: false,
    ...overrides,
  });
}

describe('extractCommands', () => {
  it('finds staff candidates and author /confirm, ignoring bots', () => {
    const { candidates, authorConfirmed } = extractCommands(
      [
        { user: { login: 'github-actions[bot]' }, body: '/approve', author_association: 'NONE' },
        { user: { login: 'student1' }, body: 'ok\n/confirm', author_association: 'NONE' },
        { user: { login: 'prof' }, body: '/deny too advanced', author_association: 'COLLABORATOR' },
        { user: { login: 'rando' }, body: '/approve', author_association: 'NONE' },
      ],
      'student1',
    );
    expect(authorConfirmed).toBe(true);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ type: 'deny', author: 'prof', reason: 'too advanced' });
    expect(candidates[1]).toMatchObject({ type: 'approve', author: 'rando', association: 'NONE' });
  });
});

describe('fresh claims', () => {
  let api;
  beforeEach(() => (api = fakeApi()));

  it('records a pending claim in review mode and leaves the issue open', async () => {
    const ctx = makeCtx(api);
    await processTrackerIssue(ctx, claimIssue({}));
    const recs = ctx.claimsDoc.claims[POOL_URL];
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ claimedBy: 'student1', status: 'pending', claimIssue: 10 });
    expect(api.calls.labels).toEqual([{ n: 10, labels: [LABELS.PENDING] }]);
    expect(api.calls.closes).toHaveLength(0); // stays open = staff inbox
    expect(api.calls.comments[0].body).toContain('in your own words');
    expect(api.calls.comments[0].body).toContain('pending staff review');
  });

  it('records active and closes in auto mode', async () => {
    const ctx = makeCtx(api, { config: { claimMode: 'auto', maxActiveClaimsPerUser: 1 } });
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL][0].status).toBe('active');
    expect(api.calls.closes).toEqual([{ n: 10, reason: 'completed' }]);
  });

  it('rejects an invalid URL', async () => {
    const ctx = makeCtx(api);
    await processTrackerIssue(ctx, claimIssue({ url: 'https://github.com/a/b/pull/3' }));
    expect(ctx.claimsDoc.claims).toEqual({});
    expect(api.calls.labels[0].labels).toEqual([LABELS.INVALID]);
    expect(api.calls.closes[0].reason).toBe('not_planned');
  });

  it('rejects blocklisted users', async () => {
    const ctx = makeCtx(api, { blocklist: ['Student1'] });
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims).toEqual({});
    expect(api.calls.closes[0].reason).toBe('not_planned');
  });

  it('rejects URLs outside the pool', async () => {
    const ctx = makeCtx(api);
    await processTrackerIssue(ctx, claimIssue({ url: 'https://github.com/not/pooled/issues/9' }));
    expect(api.calls.comments[0].body).toContain("isn't in the AI 301 issue pool");
    expect(api.calls.closes[0].reason).toBe('not_planned');
  });

  it('is idempotent for a user re-claiming their own issue', async () => {
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'Student1', claimedAt: null, status: 'active', source: 'issue-form', claimIssue: 5 },
    ];
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(1);
    expect(api.calls.comments[0].body).toContain('no need to claim again');
    expect(api.calls.closes[0].reason).toBe('completed');
  });

  it('enforces the per-user claim limit, ignoring sheet-import records', async () => {
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL_2] = [
      { claimedBy: 'student1', claimedAt: null, status: 'active', source: 'issue-form', claimIssue: 5 },
      { claimedBy: null, claimedAt: null, status: 'active', source: 'sheet-import', claimIssue: null },
    ];
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toBeUndefined();
    expect(api.calls.comments[0].body).toContain('limit');
    expect(countUserClaims(ctx.claimsDoc, 'student1')).toBe(1);
  });

  it('rejects claims on issues closed upstream (live check)', async () => {
    api = fakeApi({ live: { [POOL_URL]: { state: 'closed', assigned: false } } });
    const ctx = makeCtx(api);
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims).toEqual({});
    expect(api.calls.comments[0].body).toContain('closed');
  });

  it('warns but proceeds when the issue has an upstream assignee', async () => {
    api = fakeApi({ live: { [POOL_URL]: { state: 'open', assigned: true } } });
    const ctx = makeCtx(api);
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(1);
    expect(api.calls.comments[0].body).toContain('assigned');
  });
});

describe('duplicate claims (discouraged, not blocked)', () => {
  const existing = () => ({
    claimedBy: 'student2',
    claimedAt: null,
    status: 'active',
    source: 'issue-form',
    claimIssue: 5,
  });

  it('warns and waits without recording when there is no acknowledgement', async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [existing()];
    await processTrackerIssue(ctx, claimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(1); // unchanged
    expect(api.calls.comments[0].body).toContain('discouraged');
    expect(api.calls.labels[0].labels).toEqual([LABELS.AWAITING]);
    expect(api.calls.closes).toHaveLength(0); // stays open
  });

  it('records a second claim when the form acknowledged the duplicate', async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [existing()];
    await processTrackerIssue(ctx, claimIssue({ ack: true }));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(2);
  });

  it('proceeds after the author replies /confirm on an awaiting issue', async () => {
    const api = fakeApi({
      comments: { 10: [{ user: { login: 'student1' }, body: '/confirm', author_association: 'NONE' }] },
    });
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [existing()];
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.AWAITING] }));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(2);
  });

  it('does nothing on an awaiting issue without confirmation', async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [existing()];
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.AWAITING] }));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(1);
    expect(api.calls.comments).toHaveLength(0); // no repeat warning spam
  });
});

describe('staff review commands', () => {
  const pendingSetup = (comments) => {
    const api = fakeApi({ comments: { 10: comments }, staff: ['prof'] });
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'student1', claimedAt: null, status: 'pending', source: 'issue-form', claimIssue: 10 },
    ];
    return { api, ctx };
  };

  it('/approve activates the record and closes the issue', async () => {
    const { api, ctx } = pendingSetup([
      { user: { login: 'prof' }, body: '/approve', author_association: 'COLLABORATOR' },
    ]);
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.PENDING] }));
    const rec = ctx.claimsDoc.claims[POOL_URL][0];
    expect(rec.status).toBe('active');
    expect(rec.decidedBy).toBe('prof');
    expect(api.calls.closes).toEqual([{ n: 10, reason: 'completed' }]);
  });

  it('/deny removes the record and closes as not planned', async () => {
    const { api, ctx } = pendingSetup([
      { user: { login: 'prof' }, body: '/deny needs a smaller first issue', author_association: 'COLLABORATOR' },
    ]);
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.PENDING] }));
    expect(ctx.claimsDoc.claims[POOL_URL]).toBeUndefined();
    expect(api.calls.comments[0].body).toContain('needs a smaller first issue');
    expect(api.calls.closes).toEqual([{ n: 10, reason: 'not_planned' }]);
  });

  it('refuses /approve from non-staff (association spoof + permission check)', async () => {
    const api = fakeApi({
      comments: { 10: [{ user: { login: 'impostor' }, body: '/approve', author_association: 'COLLABORATOR' }] },
      staff: [], // permission check fails even though association claims COLLABORATOR
    });
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'student1', claimedAt: null, status: 'pending', source: 'issue-form', claimIssue: 10 },
    ];
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.PENDING] }));
    expect(ctx.claimsDoc.claims[POOL_URL][0].status).toBe('pending');
    expect(api.calls.closes).toHaveLength(0);
  });

  it('non-staff /approve gets a polite refusal once', async () => {
    const api = fakeApi({
      comments: { 10: [{ user: { login: 'buddy' }, body: '/approve', author_association: 'NONE' }] },
    });
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'student1', claimedAt: null, status: 'pending', source: 'issue-form', claimIssue: 10 },
    ];
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.PENDING] }));
    expect(api.calls.comments[0].body).toContain('Only course staff');
    expect(ctx.claimsDoc.claims[POOL_URL][0].status).toBe('pending');
  });

  it('retroactive /deny on a recorded (auto-mode) claim releases it', async () => {
    const api = fakeApi({
      comments: { 10: [{ user: { login: 'prof' }, body: '/deny', author_association: 'OWNER' }] },
      staff: ['prof'],
    });
    const ctx = makeCtx(api, { config: { claimMode: 'auto', maxActiveClaimsPerUser: 1 } });
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'student1', claimedAt: null, status: 'active', source: 'issue-form', claimIssue: 10 },
    ];
    await processTrackerIssue(ctx, claimIssue({ labels: [LABELS.CLAIM, LABELS.RECORDED] }));
    expect(ctx.claimsDoc.claims[POOL_URL]).toBeUndefined();
  });
});

describe('unclaims', () => {
  it('releases the actor’s own claim', async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'STUDENT1', claimedAt: null, status: 'active', source: 'issue-form', claimIssue: 5 },
    ];
    await processTrackerIssue(ctx, unclaimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toBeUndefined();
    expect(api.calls.comments[0].body).toContain('Congrats');
    expect(api.calls.closes[0].reason).toBe('completed');
  });

  it('routes sheet-import unclaims to staff and leaves them open', async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: null, claimedAt: null, status: 'active', source: 'sheet-import', claimIssue: null },
    ];
    await processTrackerIssue(ctx, unclaimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(1); // untouched
    expect(api.calls.labels[0].labels).toEqual([LABELS.NEEDS_STAFF]);
    expect(api.calls.closes).toHaveLength(0);
  });

  it("rejects releasing someone else's claim", async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    ctx.claimsDoc.claims[POOL_URL] = [
      { claimedBy: 'student2', claimedAt: null, status: 'active', source: 'issue-form', claimIssue: 5 },
    ];
    await processTrackerIssue(ctx, unclaimIssue({}));
    expect(ctx.claimsDoc.claims[POOL_URL]).toHaveLength(1);
    expect(api.calls.closes[0].reason).toBe('not_planned');
  });

  it('no-ops gracefully when nothing is claimed', async () => {
    const api = fakeApi();
    const ctx = makeCtx(api);
    await processTrackerIssue(ctx, unclaimIssue({}));
    expect(api.calls.comments[0].body).toContain("isn't currently claimed");
    expect(api.calls.closes[0].reason).toBe('completed');
  });
});

describe('record helpers', () => {
  it('findByClaimIssue and removeRecord round-trip', () => {
    const doc = {
      claims: {
        [POOL_URL]: [
          { claimedBy: 'a', claimIssue: 1 },
          { claimedBy: 'b', claimIssue: 2 },
        ],
      },
    };
    expect(findByClaimIssue(doc, 2)?.record.claimedBy).toBe('b');
    removeRecord(doc, POOL_URL, (r) => r.claimIssue === 2);
    expect(doc.claims[POOL_URL]).toHaveLength(1);
    removeRecord(doc, POOL_URL, (r) => r.claimIssue === 1);
    expect(doc.claims[POOL_URL]).toBeUndefined();
  });
});
