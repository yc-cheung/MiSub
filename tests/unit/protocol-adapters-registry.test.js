import { describe, it, expect } from 'vitest';
import {
    PROTOCOL_ADAPTERS,
    findAdapterByUrl,
    findAdapterByType,
    urlToProxy,
    proxyToUrl
} from '../../functions/utils/protocol-adapters/index.js';

// Per-adapter contract tests for the backend protocol-adapter registry (issue #3).
// Verifies dispatch goes through the registry and every adapter owns its protocol,
// complementing the broader fixtures in protocol-conversion-fixtures.test.js.

describe('protocol-adapter registry surface', () => {
    it('registers one adapter per supported protocol key', () => {
        const keys = PROTOCOL_ADAPTERS.map(a => a.key).sort();
        expect(keys).toEqual([
            'anytls', 'http', 'hysteria', 'hysteria2', 'https', 'naive',
            'snell', 'socks5', 'ss', 'ssd', 'ssr', 'trojan', 'tuic',
            'vless', 'vmess', 'wireguard'
        ].sort());
    });

    it('dispatches url schemes to the owning adapter', () => {
        expect(findAdapterByUrl('vless://x@a:1').key).toBe('vless');
        expect(findAdapterByUrl('hy2://x@a:1').key).toBe('hysteria2');
        expect(findAdapterByUrl('hysteria2://x@a:1').key).toBe('hysteria2');
        expect(findAdapterByUrl('ssr://abc').key).toBe('ssr');
        expect(findAdapterByUrl('ss://abc').key).toBe('ss');
        expect(findAdapterByUrl('unknown://x')).toBeNull();
        expect(findAdapterByUrl('no-scheme')).toBeNull();
    });

    it('dispatches clash types to the owning build adapter (incl. aliases & naive)', () => {
        expect(findAdapterByType('shadowsocks').key).toBe('ss');
        expect(findAdapterByType('shadowsocksr').key).toBe('ssr');
        expect(findAdapterByType('hy').key).toBe('hysteria2');
        expect(findAdapterByType('socks5').key).toBe('socks5');
        expect(findAdapterByType('http').key).toBe('http');
        expect(findAdapterByType('naive').key).toBe('naive');
        // naive matched via proxy.protocol when type isn't otherwise registered
        // (a direct type match like 'vmess' still takes precedence, matching the old if-chain order)
        expect(findAdapterByType('custom', { protocol: 'naive' }).key).toBe('naive');
        expect(findAdapterByType('vmess', { protocol: 'naive' }).key).toBe('vmess');
        expect(findAdapterByType('does-not-exist', {})).toBeNull();
    });
});

describe('per-adapter round trips (parse + build)', () => {
    const roundTripCases = [
        ['ss', { name: 'n', type: 'ss', server: 'a.com', port: 8388, cipher: 'aes-256-gcm', password: 'pw' }],
        ['ssr', { name: 'n', type: 'ssr', server: 'a.com', port: 8388, protocol: 'origin', cipher: 'aes-256-cfb', obfs: 'plain', password: 'pw' }],
        ['vmess', { name: 'n', type: 'vmess', server: 'a.com', port: 443, uuid: 'u-1', alterId: 0, cipher: 'auto' }],
        ['vless', { name: 'n', type: 'vless', server: 'a.com', port: 443, uuid: 'u-1' }],
        ['trojan', { name: 'n', type: 'trojan', server: 'a.com', port: 443, password: 'pw' }],
        ['hysteria2', { name: 'n', type: 'hysteria2', server: 'a.com', port: 443, password: 'pw' }],
        ['tuic', { name: 'n', type: 'tuic', server: 'a.com', port: 443, uuid: 'u-1', password: 'pw' }],
        ['snell', { name: 'n', type: 'snell', server: 'a.com', port: 443, psk: 'pw' }],
        ['anytls', { name: 'n', type: 'anytls', server: 'a.com', port: 443, password: 'pw' }],
        ['socks5', { name: 'n', type: 'socks5', server: 'a.com', port: 1080, username: 'u', password: 'pw' }],
        ['wireguard', { name: 'n', type: 'wireguard', server: 'a.com', port: 51820, 'private-key': 'pk' }]
    ];

    it.each(roundTripCases)('%s survives proxy -> url -> proxy', (key, proxy) => {
        const url = proxyToUrl(proxy);
        expect(url, `${key} should build a url`).toBeTruthy();

        const parsed = urlToProxy(url);
        expect(parsed, `${key} should parse back`).toBeTruthy();
        expect(parsed.type).toBe(proxy.type);
        expect(parsed.server).toBe(proxy.server);
        expect(parsed.port).toBe(proxy.port);
    });
});

describe('one-directional adapters', () => {
    it('build-only adapters produce a url from a record', () => {
        expect(proxyToUrl({ type: 'hysteria', name: 'n', server: 'a.com', port: 443, password: 'pw' }))
            .toMatch(/^hysteria:\/\//);
        expect(proxyToUrl({ type: 'http', name: 'n', server: 'a.com', port: 8080, username: 'u', password: 'pw' }))
            .toMatch(/^http:\/\//);
        expect(proxyToUrl({ type: 'naive', name: 'n', server: 'a.com', port: 443, username: 'u', password: 'pw' }))
            .toMatch(/^naive\+https:\/\//);
    });

    it('parse-only adapters produce a record from a url', () => {
        expect(urlToProxy('https://user:pw@a.com:443#n')).toMatchObject({ type: 'https', server: 'a.com', port: 443 });
        expect(urlToProxy('socks5://user:pw@a.com:1080?tls=1#n')).toMatchObject({ type: 'socks5-tls', server: 'a.com' });
    });
});
