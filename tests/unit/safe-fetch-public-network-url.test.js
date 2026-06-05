import { describe, it, expect, vi } from 'vitest';
import { safeFetchPublicNetworkUrl } from '../../functions/modules/security-utils.js';

// issue #31：订阅/Telegram import 出站抓取需逐跳重校验 redirect，挡住"恶意上游 302 跳转内网"，
// 同时放行任意公网域名（含其公网 redirect）。用可注入的 fetchImpl 驱动重定向序列。
function redirectTo(location) {
    return new Response(null, { status: 302, headers: { Location: location } });
}

describe('safeFetchPublicNetworkUrl', () => {
    it('blocks a redirect hop pointing at a private address and never fetches it', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(redirectTo('http://127.0.0.1/internal'))
            .mockResolvedValueOnce(new Response('SHOULD-NOT-REACH', { status: 200 }));

        await expect(
            safeFetchPublicNetworkUrl('https://airport.example/sub', {}, { fetchImpl })
        ).rejects.toThrow(/not allowed/i);

        expect(fetchImpl).toHaveBeenCalledTimes(1); // 仅初始请求；私网跳转目标从未被抓取
    });

    it('follows a public redirect and returns the final response', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(redirectTo('https://cdn.example/real-sub'))
            .mockResolvedValueOnce(new Response('trojan://pass@node.example:443#OK', { status: 200 }));

        const res = await safeFetchPublicNetworkUrl('https://airport.example/sub', {}, { fetchImpl });

        expect(res.status).toBe(200);
        expect(await res.text()).toContain('trojan://');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('rejects a private initial URL before any fetch', async () => {
        const fetchImpl = vi.fn();
        await expect(
            safeFetchPublicNetworkUrl('http://169.254.169.254/latest/meta-data', {}, { fetchImpl })
        ).rejects.toThrow(/not allowed/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
