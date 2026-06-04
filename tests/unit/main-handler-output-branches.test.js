import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Characterization tests for handleMisubRequest output branches.
// These lock in the *current* behavior of the three risky areas called out in
// issue #2 before the resolution stages are extracted:
//   1. profile-expiry output
//   2. the per-branch `X-MiSub-Mode` response header
//   3. the per-branch access-notification label
// They mock only StorageFactory + notifications and stub fetch, running the
// real generation pipeline (same harness as misub-request-regression.test.js).

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

const EXPIRED_NODE = `trojan://00000000-0000-0000-0000-000000000000@127.0.0.1:443#${encodeURIComponent('您的订阅已失效')}`;

function createStorageAdapter({ settings = {}, subscriptions = [], profiles = [] } = {}) {
    const store = new Map([
        ['worker_settings_v1', settings],
        ['misub_subscriptions_v1', subscriptions],
        ['misub_profiles_v1', profiles]
    ]);

    return {
        store,
        get: vi.fn(async (key) => store.has(key) ? store.get(key) : null),
        put: vi.fn(async (key, value) => {
            store.set(key, value);
            return true;
        }),
        getAllSubscriptions: vi.fn(async () => subscriptions),
        getAllProfiles: vi.fn(async () => profiles),
        getSubscriptionsByIds: vi.fn(async (ids) => subscriptions.filter(item => ids.includes(item.id)))
    };
}

function silenceLogs() {
    return vi.spyOn(console, 'log').mockImplementation(() => {});
}

async function invoke(request, { adapter, waitUntil = vi.fn() }) {
    createAdapter.mockReturnValue(adapter);
    const { handleMisubRequest } = await import('../../functions/modules/subscription/main-handler.js');
    return handleMisubRequest({ request, env: {}, waitUntil });
}

describe('handleMisubRequest output-branch characterization', () => {
    let logSpy;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getStorageType.mockResolvedValue('kv');
        logSpy = silenceLogs();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('trojan://pass@example.com:443#HK', { status: 200 })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('profile-expiry output', () => {
        function expiredProfileAdapter() {
            return createStorageAdapter({
                settings: { mytoken: 'admin-token', profileToken: 'p-token', enableTrafficNode: false },
                profiles: [{
                    id: 'grp',
                    name: 'Expired Group',
                    enabled: true,
                    expiresAt: '2000-01-01T00:00:00.000Z',
                    subscriptions: [],
                    manualNodes: []
                }]
            });
        }

        it('returns the expired placeholder node for nodes output', async () => {
            const adapter = expiredProfileAdapter();
            const response = await invoke(
                new Request('https://misub.example/p-token/grp?target=nodes', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            const text = await response.text();

            expect(response.status).toBe(200);
            expect(text).toBe(EXPIRED_NODE + '\n');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('returns the base64-encoded expired placeholder node for base64 output', async () => {
            const adapter = expiredProfileAdapter();
            const response = await invoke(
                new Request('https://misub.example/p-token/grp?target=base64', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            const text = await response.text();

            expect(response.status).toBe(200);
            expect(Buffer.from(text, 'base64').toString('utf-8')).toBe(EXPIRED_NODE + '\n');
        });
    });

    describe('per-branch X-MiSub-Mode header', () => {
        const subscriptions = [{ id: 'sub-a', name: 'Airport A', url: 'https://airport.example/sub', enabled: true }];

        it('nodes output -> node-export-plain', async () => {
            const adapter = createStorageAdapter({
                settings: { mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false },
                subscriptions
            });
            const response = await invoke(
                new Request('https://misub.example/admin-token?target=nodes&refresh=1', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(response.headers.get('X-MiSub-Mode')).toBe('node-export-plain');
        });

        it('external redirect -> external-redirect-v2', async () => {
            const adapter = createStorageAdapter({
                settings: {
                    mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false,
                    subconverter: { engineMode: 'external', defaultBackend: 'sub.example' }
                },
                subscriptions
            });
            const response = await invoke(
                new Request('https://misub.example/admin-token?target=clash&refresh=1', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(response.status).toBe(302);
            expect(response.headers.get('X-MiSub-Mode')).toBe('external-redirect-v2');
        });

        it('builtin output -> builtin-<format>', async () => {
            const adapter = createStorageAdapter({
                settings: { mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false },
                subscriptions
            });
            const response = await invoke(
                new Request('https://misub.example/admin-token?target=clash&refresh=1&builtin=true', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(response.headers.get('X-MiSub-Mode')).toBe('builtin-clash');
        });

        it('base64 output -> no X-MiSub-Mode header', async () => {
            const adapter = createStorageAdapter({
                settings: { mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false },
                subscriptions
            });
            const response = await invoke(
                new Request('https://misub.example/admin-token?target=base64&refresh=1', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(response.headers.get('X-MiSub-Mode')).toBeNull();
        });
    });

    describe('per-branch access-notification label', () => {
        const subscriptions = [{ id: 'sub-a', name: 'Airport A', url: 'https://airport.example/sub', enabled: true }];

        function labelOf() {
            const call = sendEnhancedTgNotification.mock.calls.at(-1);
            return call ? call[1] : null;
        }

        it('external redirect uses the third-party-conversion label', async () => {
            const adapter = createStorageAdapter({
                settings: {
                    mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false, enableAccessLog: true,
                    subconverter: { engineMode: 'external', defaultBackend: 'sub.example' }
                },
                subscriptions
            });
            await invoke(
                new Request('https://misub.example/admin-token?target=clash&refresh=1', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(sendEnhancedTgNotification).toHaveBeenCalledTimes(1);
            expect(labelOf()).toBe('🛰️ <b>订阅被访问</b> (第三方转换)');
        });

        it('base64 output uses the bare label', async () => {
            const adapter = createStorageAdapter({
                settings: { mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false },
                subscriptions
            });
            await invoke(
                new Request('https://misub.example/admin-token?target=base64&refresh=1', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(sendEnhancedTgNotification).toHaveBeenCalledTimes(1);
            expect(labelOf()).toBe('🛰️ <b>订阅被访问</b>');
        });

        it('builtin output uses the builtin-conversion label', async () => {
            const adapter = createStorageAdapter({
                settings: { mytoken: 'admin-token', enableFlagEmoji: false, enableTrafficNode: false },
                subscriptions
            });
            await invoke(
                new Request('https://misub.example/admin-token?target=clash&refresh=1&builtin=true', { headers: { 'User-Agent': 'ClashMeta' } }),
                { adapter }
            );
            expect(sendEnhancedTgNotification).toHaveBeenCalledTimes(1);
            expect(labelOf()).toBe('🛰️ <b>订阅被访问</b> (内置转换)');
        });
    });
});
