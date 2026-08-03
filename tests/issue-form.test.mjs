import { describe, expect, it } from 'vitest';
import {
  FIELD_DUPLICATE_ACK,
  FIELD_ISSUE_URL,
  parseIssueFormBody,
} from '../shared/issue-form.mjs';

const RENDERED_CLAIM = [
  '### Issue URL',
  '',
  'https://github.com/pytorch/pytorch/issues/123',
  '',
  '### Is someone already working on this?',
  '',
  '_No response_',
  '',
  '### Pledges',
  '',
  '- [x] I have read (or will read) the repository CONTRIBUTING guide',
  '- [x] I will introduce myself on the upstream issue in my own words',
].join('\r\n');

describe('parseIssueFormBody', () => {
  it('parses a rendered claim form', () => {
    const fields = parseIssueFormBody(RENDERED_CLAIM);
    expect(fields[FIELD_ISSUE_URL]).toBe('https://github.com/pytorch/pytorch/issues/123');
    expect(fields[FIELD_DUPLICATE_ACK]).toBe('');
    expect(fields['Pledges']).toContain('- [x]');
  });

  it('returns {} for hand-written bodies without headings', () => {
    expect(parseIssueFormBody('please give me this issue')).toEqual({});
  });

  it('keeps multi-line values and trims', () => {
    const fields = parseIssueFormBody('### Notes\n\nline one\nline two\n\n');
    expect(fields['Notes']).toBe('line one\nline two');
  });

  it('handles non-string input', () => {
    expect(parseIssueFormBody(null)).toEqual({});
  });
});
