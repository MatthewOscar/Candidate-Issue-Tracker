import { describe, expect, it } from 'vitest';
import { normalizeTag, normalizeTags, splitList } from '../shared/normalize.mjs';

describe('splitList', () => {
  it('splits semicolon lists and trims', () => {
    expect(splitList('Python; Makefile ;TypeScript')).toEqual([
      'Python',
      'Makefile',
      'TypeScript',
    ]);
  });
  it('handles empty and null', () => {
    expect(splitList('')).toEqual([]);
    expect(splitList(null)).toEqual([]);
    expect(splitList(';;')).toEqual([]);
  });
});

describe('normalizeTag', () => {
  it.each([
    ['good first issue', 'good first issue'],
    ['Good First Issue', 'good first issue'],
    ['Good first issue', 'good first issue'],
    ['good-first-issue', 'good first issue'],
    ['good_first_issue', 'good first issue'],
    ['help wanted', 'help wanted'],
    ['help-wanted', 'help wanted'],
    ['Help Wanted', 'help wanted'],
    ['  spaced   out  ', 'spaced out'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });
});

describe('normalizeTags', () => {
  it('dedupes after normalization, preserving order', () => {
    expect(normalizeTags(['Good First Issue', 'good-first-issue', 'bug'])).toEqual([
      'good first issue',
      'bug',
    ]);
  });
});
