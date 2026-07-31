import { describe, expect, it } from 'vitest';
import { cookieCredentials } from '../src/credentials.js';

describe('local access credentials', () => {
  it('keeps only a normalized Cookie and removes obsolete credential data', () => {
    expect(cookieCredentials({
      cookie: '  SUB=local  ',
      obsoleteCredential: 'must-be-removed'
    })).toEqual({
      cookie: 'SUB=local'
    });
  });
});
