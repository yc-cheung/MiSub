import { describe, expect, it } from 'vitest';
import { normalizeNodeInput } from '../../src/utils/protocols/normalizeNodeInput.js';

describe('normalizeNodeInput', () => {
  it('converts a Surge-format snell line to a snell:// url', () => {
    const line = '🇺🇸[BWH]MegaBox = snell, 104.224.1.1, 35517, psk=K5DGUzvNATX7VXS4lbpH, version=5, reuse=true';
    const url = normalizeNodeInput(line);
    expect(url).toMatch(/^snell:\/\//);
    expect(url).toContain('K5DGUzvNATX7VXS4lbpH@104.224.1.1:35517');
    expect(url).toContain('version=5');
    expect(url).toContain('reuse=true');
  });

  it('passes through an existing snell:// node URL unchanged', () => {
    const url = 'snell://psk@1.2.3.4:443?version=4#HK';
    expect(normalizeNodeInput(url)).toBe(url);
  });

  it('passes through an http(s) subscription URL unchanged', () => {
    const url = 'https://example.com/sub';
    expect(normalizeNodeInput(url)).toBe(url);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeNodeInput('  ss://YWVzOnBhc3M@1.2.3.4:8388#HK \n')).toBe('ss://YWVzOnBhc3M@1.2.3.4:8388#HK');
  });

  it('converts other Surge protocols (trojan) too', () => {
    const url = normalizeNodeInput('Node = trojan, 1.2.3.4, 443, password=abc');
    expect(url).toMatch(/^trojan:\/\//);
  });

  it('returns null for unrecognized text', () => {
    expect(normalizeNodeInput('just some random text')).toBeNull();
    expect(normalizeNodeInput('')).toBeNull();
    expect(normalizeNodeInput(null)).toBeNull();
    expect(normalizeNodeInput(undefined)).toBeNull();
  });
});
