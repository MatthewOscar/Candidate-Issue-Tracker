import { describe, expect, it } from 'vitest';
import { buildBatchQuery, statusFromNode, statusesEqual } from '../scripts/sync-status.mjs';

describe('buildBatchQuery', () => {
  it('aliases each URL and quotes safely', () => {
    const q = buildBatchQuery([
      'https://github.com/a/b/issues/1',
      'https://github.com/c/d/issues/2',
    ]);
    expect(q).toContain('r0: resource(url: "https://github.com/a/b/issues/1")');
    expect(q).toContain('r1: resource(url: "https://github.com/c/d/issues/2")');
    expect(q).toContain('... on Issue { state stateReason updatedAt assignees(first: 1) { totalCount } }');
    expect(q.startsWith('query {')).toBe(true);
    expect(q.trim().endsWith('}')).toBe(true);
  });
});

describe('statusFromNode', () => {
  it('maps an open issue', () => {
    expect(
      statusFromNode({
        __typename: 'Issue',
        state: 'OPEN',
        stateReason: null,
        updatedAt: '2026-01-01T00:00:00Z',
        assignees: { totalCount: 0 },
      }),
    ).toEqual({ state: 'open', stateReason: null, assigned: false, updatedAt: '2026-01-01T00:00:00Z' });
  });

  it('maps a closed-completed issue with assignee', () => {
    expect(
      statusFromNode({
        __typename: 'Issue',
        state: 'CLOSED',
        stateReason: 'COMPLETED',
        updatedAt: '2026-01-02T00:00:00Z',
        assignees: { totalCount: 2 },
      }),
    ).toEqual({
      state: 'closed',
      stateReason: 'completed',
      assigned: true,
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });

  it('maps null and non-Issue nodes (moved/deleted/converted) to missing', () => {
    expect(statusFromNode(null).state).toBe('missing');
    expect(statusFromNode({ __typename: 'PullRequest' }).state).toBe('missing');
  });
});

describe('statusesEqual', () => {
  const a = { generatedAt: 'x', statuses: { u: { state: 'open' } } };
  it('ignores generatedAt', () => {
    expect(statusesEqual(a, { generatedAt: 'y', statuses: { u: { state: 'open' } } })).toBe(true);
  });
  it('detects real changes', () => {
    expect(statusesEqual(a, { generatedAt: 'x', statuses: { u: { state: 'closed' } } })).toBe(false);
  });
});
