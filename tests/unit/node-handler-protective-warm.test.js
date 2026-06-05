import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createAdapter = vi.fn();
const getStorageType = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...a) => createAdapter(...a),
        getStorageType: (...a) => getStorageType(...a)
    }
}));

import { handleNodeCountRequest } from '../../functions/modules/handlers/node-handler.js';
import { buildSubscriptionNodeCacheKey } from '../../functions/services/protective-node-cache.js';

function memAdapter(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, v); return true; },
        async delete(k) { store.delete(k); return true; }
    };
}

function nodeCountRequest(url) {
    return new Request('https://misub.example/api/node_count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
}

describe('handleNodeCountRequest 预热保护性缓存', () => {
    beforeEach(() => { getStorageType.mockResolvedValue('kv'); });
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

    it('enableNodeCache 开启的订阅，更新节点数成功时写入保护性快照（原始节点）', async () => {
        const sub = { id: 'sub-a', name: '机场A', url: 'https://airport.example/sub', enableNodeCache: true };
        const adapter = memAdapter({ misub_subscriptions_v1: [sub] });
        createAdapter.mockReturnValue(adapter);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('trojan://a@h:443#A\ntrojan://b@h:443#B', { status: 200 })));

        const res = await handleNodeCountRequest(nodeCountRequest(sub.url), {});
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.data.count).toBe(2);

        const cache = adapter.store.get(buildSubscriptionNodeCacheKey(sub));
        expect(cache?.nodes).toEqual(['trojan://a@h:443#A', 'trojan://b@h:443#B']);
    });

    it('enableNodeCache 关闭的订阅，更新节点数成功时不写快照', async () => {
        const sub = { id: 'sub-b', name: '机场B', url: 'https://airport2.example/sub', enableNodeCache: false };
        const adapter = memAdapter({ misub_subscriptions_v1: [sub] });
        createAdapter.mockReturnValue(adapter);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('trojan://a@h:443#A', { status: 200 })));

        const res = await handleNodeCountRequest(nodeCountRequest(sub.url), {});
        expect((await res.json()).success).toBe(true);
        expect(adapter.store.get(buildSubscriptionNodeCacheKey(sub))).toBeUndefined();
    });
});
