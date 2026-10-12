import { expect, it } from 'vitest';
import { backendOrigin, allowedMutationOrigin } from '../lib/deployment';

it('keeps local deployment unchanged and requires a backend for Vercel', () => {
  expect(backendOrigin(undefined)).toBeNull();
  expect(() => backendOrigin(undefined, true)).toThrow('ORBIT_BACKEND_URL');
  expect(backendOrigin('https://backend.example.com/')).toBe('https://backend.example.com');
  expect(backendOrigin('http://127.0.0.1:3200')).toBe('http://127.0.0.1:3200');
});

it.each([
  'http://remote.example.com',
  'https://user:pass@backend.example.com',
  'https://backend.example.com/api',
  'https://backend.example.com?x=1',
  'https://backend.example.com#x',
])('rejects unsafe backend configuration %s', (url) => {
  expect(() => backendOrigin(url)).toThrow();
});

it('requires HTTPS for a Vercel backend even when it points to localhost', () => {
  expect(() => backendOrigin('http://localhost:3200', true)).toThrow();
});

it('permits the configured frontend through a proxy without accepting other origins', () => {
  expect(
    allowedMutationOrigin(
      'https://orbit.example.com',
      'backend.example.com',
      'https://orbit.example.com',
    ),
  ).toBe(true);
  expect(
    allowedMutationOrigin(
      'https://attacker.example.com',
      'backend.example.com',
      'https://orbit.example.com',
    ),
  ).toBe(false);
  expect(
    allowedMutationOrigin(
      'https://backend.example.com',
      'backend.example.com',
      'https://orbit.example.com',
    ),
  ).toBe(false);
  expect(
    allowedMutationOrigin(
      'https://orbit.example.com.attacker.invalid',
      'backend.example.com',
      'https://orbit.example.com',
    ),
  ).toBe(false);
});

it('retains same-host local protection and rejects malformed browser origins', () => {
  expect(allowedMutationOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
  expect(allowedMutationOrigin('http://localhost:3001', 'localhost:3000')).toBe(false);
  expect(allowedMutationOrigin('null', 'localhost:3000')).toBe(false);
  expect(allowedMutationOrigin('file://localhost', 'localhost')).toBe(false);
  expect(allowedMutationOrigin('https://orbit.example.com/path', 'orbit.example.com')).toBe(false);
  expect(allowedMutationOrigin(null, 'localhost:3000')).toBe(true);
});
