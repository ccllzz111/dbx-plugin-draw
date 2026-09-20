import { describe, expect, it } from 'vitest';
import { parseRecentFiles, rememberFile, type RecentFile } from './recent';
const file = (id: string, openedAt = 1): RecentFile => ({ id, name: 'diagram.drawio', xml: '<mxGraphModel><root/></mxGraphModel>', openedAt });

describe('recent documents', () => {
  it('keeps ten entries, replaces the same document and moves it to the front', () => {
    let files: RecentFile[] = [];
    for (let i = 0; i < 12; i++) files = rememberFile(files, file(String(i), i));
    expect(files).toHaveLength(10);
    files = rememberFile(files, { ...file('5', 20), xml: '<mxGraphModel/>' });
    expect(files[0].id).toBe('5');
    expect(files.filter(f => f.id === '5')).toHaveLength(1);
    expect(files.some(f => f.id === '0')).toBe(false);
  });
  it('preserves different documents with identical names', () => {
    expect(rememberFile([file('a')], file('b'))).toHaveLength(2);
  });
  it('ignores malformed storage and deduplicates IDs', () => {
    expect(parseRecentFiles({})).toEqual([]);
    expect(parseRecentFiles([null, {}, file('a'), file('a'), { ...file('b'), xml: '<html/>' }])).toEqual([file('a')]);
  });
  it('rejects oversized records without erasing existing history', () => {
    const previous = [file('a')];
    expect(() => rememberFile(previous, { ...file('b'), xml: '中'.repeat(600_000) })).toThrow('too large');
    expect(previous).toHaveLength(1);
  });
});
