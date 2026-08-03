import { describe, expect, it } from 'vitest';
import {
  canonicalizeIssueUrl,
  parseHyperlinkFormula,
  repoKeyFromUrl,
} from '../shared/canonical.mjs';

describe('canonicalizeIssueUrl', () => {
  it('canonicalizes a plain issue URL', () => {
    expect(canonicalizeIssueUrl('https://github.com/pytorch/pytorch/issues/123')).toEqual({
      url: 'https://github.com/pytorch/pytorch/issues/123',
      org: 'pytorch',
      repo: 'pytorch',
      number: 123,
    });
  });

  it('lowercases the join key but preserves display casing', () => {
    const parsed = canonicalizeIssueUrl(
      'https://github.com/GenericMappingTools/pygmt/issues/9',
    );
    expect(parsed?.url).toBe('https://github.com/genericmappingtools/pygmt/issues/9');
    expect(parsed?.org).toBe('GenericMappingTools');
  });

  it.each([
    'http://github.com/a/b/issues/1',
    'https://www.github.com/a/b/issues/1',
    'https://github.com/a/b/issues/1/',
    'https://github.com/a/b/issues/1?tab=comments',
    'https://github.com/a/b/issues/1#issuecomment-99',
    '  https://github.com/a/b/issues/1  ',
    'github.com/a/b/issues/1',
  ])('normalizes variant %s', (variant) => {
    expect(canonicalizeIssueUrl(variant)?.url).toBe('https://github.com/a/b/issues/1');
  });

  it.each([
    'https://github.com/a/b/pull/1',
    'https://github.com/a/b/discussions/1',
    'https://github.com/a/b',
    'https://gitlab.com/a/b/issues/1',
    'https://github.com/a/b/issues/notanumber',
    'https://github.com/a/b/issues/0',
    'not a url',
    '',
    null,
    42,
  ])('rejects %s', (bad) => {
    expect(canonicalizeIssueUrl(bad)).toBeNull();
  });
});

describe('repoKeyFromUrl', () => {
  it('returns the lowercased org/repo', () => {
    expect(repoKeyFromUrl('https://github.com/OpenTelemetry/Docs/issues/5')).toBe(
      'opentelemetry/docs',
    );
  });
  it('returns null for non-issue URLs', () => {
    expect(repoKeyFromUrl('https://github.com/a/b/pull/1')).toBeNull();
  });
});

describe('parseHyperlinkFormula', () => {
  it('extracts the URL from a real sheet formula (no leading =)', () => {
    expect(
      parseHyperlinkFormula(
        'HYPERLINK("https://github.com/open-telemetry/opentelemetry-dotnet/issues/5924", "GitHub")',
      ),
    ).toBe('https://github.com/open-telemetry/opentelemetry-dotnet/issues/5924');
  });

  it('tolerates a leading = and whitespace', () => {
    expect(parseHyperlinkFormula('=HYPERLINK( "https://github.com/a/b/issues/1", "x")')).toBe(
      'https://github.com/a/b/issues/1',
    );
  });

  it('returns null for other formulas and non-strings', () => {
    expect(parseHyperlinkFormula('SUM(A1:A2)')).toBeNull();
    expect(parseHyperlinkFormula(undefined)).toBeNull();
  });
});
