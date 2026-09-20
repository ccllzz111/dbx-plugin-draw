// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installVfsShim } from './vfs';

const assets = new Map([
  ['test.txt', { contentType: 'text/plain', bytes: new TextEncoder().encode('hello') }],
  ['styles/test.css', { contentType: 'text/css', bytes: new TextEncoder().encode('body{background:url(../images/test.png)}') }],
  ['images/test.png', { contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
]);
const read = vi.fn(async (path: string) => {
  const asset = assets.get(path);
  if (!asset) throw new Error('missing');
  return asset;
});
const blobs: Blob[] = [];
beforeAll(() => {
  URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return `blob:test-${blobs.length}`; });
  installVfsShim(read);
});

describe('VFS XMLHttpRequest', () => {
  it('fires the property handler and each registered listener exactly once', async () => {
    const xhr = new XMLHttpRequest();
    const handler = vi.fn();
    const listener = vi.fn();
    const removed = vi.fn();
    xhr.onload = handler;
    xhr.addEventListener('load', listener);
    xhr.addEventListener('load', removed);
    xhr.removeEventListener('load', removed);
    xhr.open('GET', 'test.txt');
    xhr.send();
    await vi.waitFor(() => expect(xhr.readyState).toBe(4));
    expect(xhr.responseText).toBe('hello');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
  it('does not deliver a response after abort', async () => {
    const xhr = new XMLHttpRequest();
    const handler = vi.fn();
    xhr.onload = handler;
    xhr.open('GET', 'test.txt');
    xhr.send();
    xhr.abort();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(handler).not.toHaveBeenCalled();
    expect(xhr.readyState).toBe(0);
  });
});

it('rewrites relative CSS assets for setAttribute as well as href setters', async () => {
  const link = document.createElement('link');
  link.setAttribute('href', 'styles/test.css');
  await vi.waitFor(() => expect(link.getAttribute('href')).toMatch(/^blob:/));
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blobs.at(-1)!);
  });
  expect(text).toContain('data:image/png;base64,AQID');
});
