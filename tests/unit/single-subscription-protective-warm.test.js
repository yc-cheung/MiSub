import { afterEach, describe, expect, it, vi } from 'vitest';

const createAdapter = vi.fn();
const getStorageType = vi.fn();
const fetchSubscriptionNodes = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...a) => createAdapter(...a),
        getStorageType: (...a) => getStorageType(...a)
    }
}));

vi.mock('../../functions/modules/subscription/node-fetcher.js', () => ({
    fetchSubscriptionNodes: (...a) => fetchSubscriptionNodes(...a)
}));

import { handleSingleSubscriptionMode } from '../../functions/modules/subscription/single-subscription.js';
import { buildSubscriptionNodeCacheKey } from '../../functions/services/protective-node-cache.js';

function memAdapter(sub) {
    const store = new Map();
    return {
        store,
        async getSubscriptionById() { return sub; },
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, v); return true; },
        async delete(k) { store.delete(k); return true; }
    };
}

describe('handleSingleSubscriptionMode 预热保护性缓存', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('单订阅预览成功且开启 enableNodeCache 时写入原始节点快照', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A', enableNodeCache: true };
        const adapter = memAdapter(sub);
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({
            subscriptionName: '机场A', url: sub.url, success: true,
            nodes: [{ url: 'trojan://a@h:443#A' }, { url: 'trojan://b@h:443#B' }], error: null
        });

        await handleSingleSubscriptionMode(new Request('https://misub.example/preview'), {}, 'sub-1', 'ClashMeta', false);

        const cache = adapter.store.get(buildSubscriptionNodeCacheKey(sub));
        expect(cache?.nodes).toEqual(['trojan://a@h:443#A', 'trojan://b@h:443#B']);
    });

    it('单订阅未开启 enableNodeCache 时不写快照', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-2', enabled: true, url: 'https://airport2.example/sub', name: '机场B', enableNodeCache: false };
        const adapter = memAdapter(sub);
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({
            subscriptionName: '机场B', url: sub.url, success: true,
            nodes: [{ url: 'trojan://a@h:443#A' }], error: null
        });

        await handleSingleSubscriptionMode(new Request('https://misub.example/preview'), {}, 'sub-2', 'ClashMeta', false);

        expect(adapter.store.get(buildSubscriptionNodeCacheKey(sub))).toBeUndefined();
    });
});
