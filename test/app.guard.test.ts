import { describe, it as test } from 'node:test';
import { blockedRequest } from '../src/app/guard.ts';
import { expect } from './expect.ts';

describe('blockedRequest', () => {
  for (const host of ['127.0.0.1:4321', 'localhost:4321', 'localhost:5173', '[::1]:4321', 'localhost', 'LOCALHOST:4321'])
    test(`lets a GET to ${host} through`, () => expect(blockedRequest('GET', { host })).toBeUndefined());

  for (const host of ['evil.example:4321', 'evil.example', '127.0.0.1.evil.example', 'localhost.evil.example:4321', '10.0.0.5:4321', ''])
    test(`blocks a request to host ${JSON.stringify(host)}, as a rebound DNS name would send`, () =>
      expect(blockedRequest('GET', { host })).toMatch(/host/i));

  test('blocks a request with no Host header', () => expect(blockedRequest('GET', {})).toMatch(/host/i));

  test('a POST from the page itself, or through the dev proxy, goes through', () => {
    expect(blockedRequest('POST', { host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' })).toBeUndefined();
    expect(blockedRequest('POST', { host: 'localhost:5173', origin: 'http://localhost:5173' })).toBeUndefined();
  });

  test('a POST with no Origin goes through: curl, Node fetch and the tests send none, and a browser always sends one cross-site', () =>
    expect(blockedRequest('POST', { host: '127.0.0.1:4321' })).toBeUndefined());

  for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'null', 'not a url'])
    test(`blocks a POST from origin ${origin}`, () => expect(blockedRequest('POST', { host: '127.0.0.1:4321', origin })).toMatch(/origin/i));

  test('a GET from another origin is left to the browser, which does not let that page read the answer', () =>
    expect(blockedRequest('GET', { host: '127.0.0.1:4321', origin: 'https://evil.example' })).toBeUndefined());
});
