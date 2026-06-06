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

import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { buildSubscriptionNodeCacheKey } from '../../functions/services/protective-node-cache.js';

function memAdapter({ profile, subs, snapshots = {} }) {
    const store = new Map();
    for (const [subKey, snap] of Object.entries(snapshots)) {
        const sub = subs.find(s => s.id === subKey);
        if (sub) store.set(buildSubscriptionNodeCacheKey(sub), snap);
    }
    return {
        store,
        async getProfileById() { return profile; },
        async getSubscriptionsByIds() { return subs; },
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, v); return true; },
        async delete(k) { store.delete(k); return true; }
    };
}

const req = () => new Request('https://misub.example/preview');

describe('handleProfileMode 保护性缓存回退', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('成员机场拉取失败且有快照时，缓存节点进入聚合结果并计入 cachedSourceCount', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A', enableNodeCache: true };
        const adapter = memAdapter({
            profile: { id: 'profile-1', enabled: true, subscriptions: ['sub-1'], manualNodes: [] },
            subs: [sub],
            snapshots: {
                'sub-1': {
                    nodes: ['trojan://[email protected]:443#HK-01', 'trojan://[email protected]:443#HK-02'],
                    nodeCount: 2,
                    sourceUrl: sub.url,
                    updatedAt: '2026-06-01T00:00:00.000Z'
                }
            }
        });
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({ subscriptionName: '机场A', url: sub.url, success: false, nodes: [], error: 'HTTP 503' });

        const result = await handleProfileMode(req(), {}, 'profile-1', 'MiSub-Node-Preview/1.0', false, false);

        expect(result.fromCache).toBe(true);
        expect(result.cachedSourceCount).toBe(1);
        expect(result.nodes).toHaveLength(2);
    });

    it('回退的缓存节点在 applyTransform 时仍走 operator 重命名管线', async () => {
        getStorageType.mockResolvedValue('kv');
        const sub = { id: 'sub-1', enabled: true, url: 'https://airport.example/sub', name: '机场A', enableNodeCache: true };
        const adapter = memAdapter({
            profile: {
                id: 'profile-1', enabled: true, subscriptions: ['sub-1'], manualNodes: [],
                operators: [{
                    id: 'rename-1', type: 'rename', enabled: true,
                    params: { regex: { enabled: true, rules: [{ pattern: 'Raw', replacement: 'Renamed' }] } }
                }]
            },
            subs: [sub],
            snapshots: {
                'sub-1': {
                    nodes: ['trojan://password@example.com:443#Raw%20Node'],
                    nodeCount: 1,
                    sourceUrl: sub.url,
                    updatedAt: '2026-06-01T00:00:00.000Z'
                }
            }
        });
        createAdapter.mockReturnValue(adapter);
        fetchSubscriptionNodes.mockResolvedValue({ subscriptionName: '机场A', url: sub.url, success: false, nodes: [], error: 'HTTP 503' });

        const result = await handleProfileMode(req(), {}, 'profile-1', 'MiSub-Node-Preview/1.0', true, false);

        expect(result.fromCache).toBe(true);
        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].name).toBe('Renamed Node');
    });
});
