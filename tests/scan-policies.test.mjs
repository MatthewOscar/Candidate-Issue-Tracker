import { describe, expect, it } from 'vitest';
import {
  buildRepoBatchQuery,
  DOC_PATHS,
  scanRepoNode,
  scansEqual,
  scanText,
} from '../scripts/scan-policies.mjs';

describe('scanText', () => {
  it('finds policy phrases with word boundaries', () => {
    const hits = scanText('We do not accept AI-generated pull requests.');
    expect(hits.map((h) => h.keyword)).toContain('ai-generated');
  });

  it('does not fire on generic ML prose (no bare "ai" keyword)', () => {
    expect(scanText('This library trains AI models for computer vision.')).toEqual([]);
  });

  it('does not match inside larger words', () => {
    expect(scanText('The compilation slops over — misllm nothing here.')).toEqual([]);
    expect(scanText('Total slop is not welcome.').map((h) => h.keyword)).toContain('slop');
  });

  it('produces a bounded snippet with ellipses', () => {
    const text = `${'x'.repeat(500)} chatgpt ${'y'.repeat(500)}`;
    const [hit] = scanText(text);
    expect(hit.snippet.length).toBeLessThan(400);
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
  });
});

describe('buildRepoBatchQuery', () => {
  it('aliases repos and all doc paths', () => {
    const q = buildRepoBatchQuery([
      ['pytorch', 'pytorch'],
      ['a', 'b'],
    ]);
    expect(q).toContain('repo0: repository(owner: "pytorch", name: "pytorch")');
    expect(q).toContain('repo1: repository(owner: "a", name: "b")');
    for (let j = 0; j < DOC_PATHS.length; j++) expect(q).toContain(`p${j}: object(`);
    expect(q).toContain('"HEAD:CONTRIBUTING.md"');
  });
});

describe('scanRepoNode', () => {
  it('maps missing repos to repo-missing', () => {
    expect(scanRepoNode(null, 'a/b', 'now')).toMatchObject({ error: 'repo-missing', hits: [] });
  });

  it('collects hits across paths with source URLs', () => {
    const node = {
      nameWithOwner: 'a/b',
      isArchived: false,
      p0: { text: 'No ai-generated code here please.' },
      p3: { text: 'plain readme' },
    };
    const entry = scanRepoNode(node, 'a/b', 'now');
    expect(entry.error).toBeNull();
    expect(entry.hits).toHaveLength(1);
    expect(entry.hits[0]).toMatchObject({
      path: 'CONTRIBUTING.md',
      keyword: 'ai-generated',
      url: 'https://github.com/a/b/blob/HEAD/CONTRIBUTING.md',
    });
  });

  it('flags archived repos', () => {
    expect(scanRepoNode({ isArchived: true }, 'a/b', 'now').error).toBe('archived');
  });
});

describe('scansEqual', () => {
  it('ignores timestamps but not hits', () => {
    const a = { generatedAt: '1', repos: { 'a/b': { scannedAt: '1', error: null, hits: [] } } };
    const b = { generatedAt: '2', repos: { 'a/b': { scannedAt: '2', error: null, hits: [] } } };
    expect(scansEqual(a, b)).toBe(true);
    b.repos['a/b'].hits = [{ path: 'x', keyword: 'llm', snippet: 's', url: 'u' }];
    expect(scansEqual(a, b)).toBe(false);
  });
});
