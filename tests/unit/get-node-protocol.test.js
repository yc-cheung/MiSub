import { describe, expect, it } from 'vitest';
import { getNodeProtocol } from '../../src/utils/protocols/getNodeProtocol.js';

describe('getNodeProtocol', () => {
  it('把节点 URL 映射到协议标识', () => {
    const cases = {
      'anytls://x@h:1': 'anytls',
      'hysteria2://x@h:1': 'hysteria2',
      'hy2://x@h:1': 'hysteria2',
      'hysteria://x@h:1': 'hysteria',
      'hy://x@h:1': 'hysteria',
      'ssr://abc': 'ssr',
      'tuic://x@h:1': 'tuic',
      'ss://abc@h:1': 'ss',
      'vmess://abc': 'vmess',
      'vless://x@h:1': 'vless',
      'trojan://x@h:1': 'trojan',
      'socks5://x@h:1': 'socks5',
      'socks://x@h:1': 'socks5',
      'snell://x@h:1': 'snell',
      'naive+https://x@h:1': 'naive',
      'naive+quic://x@h:1': 'naive',
      'http://h:1': 'http',
      'https://h/sub': 'http',
    };
    for (const [url, expected] of Object.entries(cases)) {
      expect(getNodeProtocol(url), url).toBe(expected);
    }
  });

  it('大小写不敏感，无法识别或空值返回 unknown', () => {
    expect(getNodeProtocol('SNELL://x@h:1')).toBe('snell');
    expect(getNodeProtocol('garbage')).toBe('unknown');
    expect(getNodeProtocol('')).toBe('unknown');
    expect(getNodeProtocol(null)).toBe('unknown');
  });
});
