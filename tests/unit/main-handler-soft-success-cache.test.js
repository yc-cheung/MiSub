import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSubscriptionNodeCacheKey } from '../../functions/services/protective-node-cache.js';

const createAdapter = vi.fn();
const getStorageType = vi.fn();
const sendEnhancedTgNotification = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: (...args) => getStorageType(...args),
        resolveKV: () => null
    }
}));

vi.mock('../../functions/modules/notifications.js', () => ({
    sendEnhancedTgNotification: (...args) => sendEnhancedTgNotification(...args),
    tgEscape: (value) => value
}));

function createStorageAdapter({ settings = {}, subscriptions = [], profiles = [] } = {}) {
    const store = new Map([
        ['worker_settings_v1', settings],
        ['misub_subscriptions_v1', subscriptions],
        ['misub_profiles_v1', profiles]
    ]);
    return {
        store,
        get: vi.fn(async (key) => store.has(key) ? store.get(key) : null),
        put: vi.fn(async (key, value) => { store.set(key, value); return true; }),
        getAllSubscriptions: vi.fn(async () => subscriptions),
        getAllProfiles: vi.fn(async () => profiles),
        getSubscriptionsByIds: vi.fn(async (ids) => subscriptions.filter(item => ids.includes(item.id)))
    };
}

async function invoke(request, { adapter, waitUntil = vi.fn() }) {
    createAdapter.mockReturnValue(adapter);
    const { handleMisubRequest } = await import('../../functions/modules/subscription/main-handler.js');
    return handleMisubRequest({ request, env: {}, waitUntil });
}

describe('Combined-List Cache 软成功写入', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getStorageType.mockResolvedValue('kv');
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('成员机场拉取失败但有快照时，组合结果非空，软成功仍写入快速缓存', async () => {
        const sub = { id: 'sub-a', name: '机场A', url: 'https://airport.example/sub', enabled: true, enableNodeCache: true };
        const adapter = createStorageAdapter({
            settings: { mytoken: 'admin-token', profileToken: 'p-token', enableTrafficNode: false },
            subscriptions: [sub],
            profiles: [{ id: 'grp', name: 'G', enabled: true, subscriptions: ['sub-a'], manualNodes: [] }]
        });
        adapter.store.set(buildSubscriptionNodeCacheKey(sub), {
            nodes: ['trojan://cached@example.com:443#Cached'],
            nodeCount: 1,
            updatedAt: '2026-01-01T00:00:00.000Z'
        });
        vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })));

        const response = await invoke(
            new Request('https://misub.example/p-token/grp?target=nodes', { headers: { 'User-Agent': 'ClashMeta' } }),
            { adapter }
        );
        const text = await response.text();
        expect(text).toContain('Cached'); // 对外仍供出缓存节点

        const combined = adapter.store.get('node_cache_profile_grp');
        expect(combined).toBeTruthy();
        expect(combined.nodeCount).toBeGreaterThan(0);
    });
});
