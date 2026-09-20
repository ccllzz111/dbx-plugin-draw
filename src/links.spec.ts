import { describe, expect, it } from 'vitest';
import { externalLink, SHORTCUTS_URL } from './links';

describe('external help links', () => {
  it('resolves shortcuts to the official site, independent of srcdoc', () => {
    expect(externalLink('shortcuts.svg')).toBe(SHORTCUTS_URL);
    expect(externalLink('https://www.drawio.com/doc/faq/math-typesetting')).toBe('https://www.drawio.com/doc/faq/math-typesetting');
  });
  it('does not open executable URLs or internal diagram links', () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,test', '#page-1', 'data:page/id', null]) {
      expect(externalLink(link)).toBeNull();
    }
  });
});
