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

const SNAPSHOT_NODES = ['trojan://[email protected]:443#HK-01', 'trojan://[email protected]:443#HK-02'];

function memAdapter(sub, snapshot = null) {
    const store = new Map();
    if (snapshot) store.set(buildSubscriptionNodeCacheKey(sub), snapshot);
    return {
        store,
        async getSubscriptionById() { return sub; },
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, v); return true; },
        async delete(k) { store.delete(k); return true; }
    };
}

const req = () => new Request('https://misub.example/preview');

describe('handleSingleSubscriptionMode 保护性缓存回退', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('机场拉取失败且开启 enableNodeCache 时，回退展示缓存节点并标记 fromCache', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A', enableNodeCache: true };
        const adapter = memAdapter(sub, {
            nodes: SNAPSHOT_NODES,
            nodeCount: 2,
            sourceUrl: sub.url,
            updatedAt: '2026-06-01T00:00:00.000Z'
        });
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({
            subscriptionName: '机场A', url: sub.url, success: false, nodes: [], error: 'HTTP 503: Service Unavailable'
        });

        const result = await handleSingleSubscriptionMode(req(), {}, 'sub-1', 'MiSub-Node-Preview/1.0', false);

        expect(result.success).toBe(true);
        expect(result.fromCache).toBe(true);
        expect(result.lastSuccess).toBe('2026-06-01T00:00:00.000Z');
        expect(result.nodes).toHaveLength(2);
        expect(result.totalCount).toBe(2);
    });

    it('机场拉取正常时展示实时节点，不出现 fromCache', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A', enableNodeCache: true };
        // 旧快照存在但实时健康（数量未骤降）→ 应保留实时
        const adapter = memAdapter(sub, { nodes: SNAPSHOT_NODES, nodeCount: 2, sourceUrl: sub.url, updatedAt: '2026-06-01T00:00:00.000Z' });
        createAdapter.mockReturnValue(adapter);
        const liveNodes = [{ url: 'trojan://[email protected]:443#JP-01' }, { url: 'trojan://[email protected]:443#JP-02' }];
        fetchSubscriptionNodes.mockResolvedValue({ subscriptionName: '机场A', url: sub.url, success: true, nodes: liveNodes, error: null });

        const result = await handleSingleSubscriptionMode(req(), {}, 'sub-1', 'MiSub-Node-Preview/1.0', false);

        expect(result.fromCache).toBeFalsy();
        expect(result.nodes.map(n => n.url)).toEqual(liveNodes.map(n => n.url));
    });

    it('未开启 enableNodeCache 时即使有快照，失败也展示空（不回退）', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A', enableNodeCache: false };
        const adapter = memAdapter(sub, { nodes: SNAPSHOT_NODES, nodeCount: 2, sourceUrl: sub.url, updatedAt: '2026-06-01T00:00:00.000Z' });
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({ subscriptionName: '机场A', url: sub.url, success: false, nodes: [], error: 'HTTP 503' });

        const result = await handleSingleSubscriptionMode(req(), {}, 'sub-1', 'MiSub-Node-Preview/1.0', false);

        expect(result.fromCache).toBeFalsy();
        expect(result.nodes).toHaveLength(0);
    });

    it('回退的缓存节点仍遵守订阅的 exclude 过滤规则', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = {
            id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A',
            enableNodeCache: true, exclude: 'US'
        };
        const adapter = memAdapter(sub, {
            nodes: [
                'trojan://[email protected]:443#HK-01',
                'trojan://[email protected]:443#HK-02',
                'trojan://[email protected]:443#US-01'
            ],
            nodeCount: 3,
            sourceUrl: sub.url,
            updatedAt: '2026-06-01T00:00:00.000Z'
        });
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({ subscriptionName: '机场A', url: sub.url, success: false, nodes: [], error: 'HTTP 503' });

        const result = await handleSingleSubscriptionMode(req(), {}, 'sub-1', 'MiSub-Node-Preview/1.0', false);

        expect(result.fromCache).toBe(true);
        expect(result.nodes).toHaveLength(2);
        expect(result.nodes.every(n => !/US/.test(n.name))).toBe(true);
    });
});
