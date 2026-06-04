import { describe, expect, it, vi } from 'vitest';

// Direct unit tests for the two resolution stages extracted from handleMisubRequest
// (issue #2). These exercise the functions independently of the request handler,
// asserting they return plain objects and that the profile is resolved exactly once.

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: { createAdapter: vi.fn(), getStorageType: vi.fn(), resolveKV: () => null }
}));

const { resolveTarget, resolveGenerationSettings } = await import('../../functions/modules/subscription/main-handler.js');

const EXPIRED_NODE = `trojan://00000000-0000-0000-0000-000000000000@127.0.0.1:443#${encodeURIComponent('您的订阅已失效')}`;

describe('resolveTarget', () => {
    it('returns enabled subscriptions for the admin token branch', async () => {
        const allMisubs = [
            { id: 'a', url: 'https://a.example', enabled: true },
            { id: 'b', url: 'https://b.example', enabled: false }
        ];
        const result = await resolveTarget({
            token: 'admin', profileIdentifier: null,
            config: { mytoken: 'admin', FileName: 'MiSub' },
            allProfiles: [], allMisubs, storageAdapter: {}
        });

        expect(result.errorResponse).toBeUndefined();
        expect(result.currentProfile).toBeNull();
        expect(result.isProfileExpired).toBe(false);
        expect(result.subName).toBe('MiSub');
        expect(result.targetMisubs).toEqual([{ id: 'a', url: 'https://a.example', enabled: true }]);
    });

    it('returns a 403 errorResponse for an invalid admin token', async () => {
        const result = await resolveTarget({
            token: 'wrong', profileIdentifier: null,
            config: { mytoken: 'admin' }, allProfiles: [], allMisubs: [], storageAdapter: {}
        });
        expect(result.errorResponse).toBeInstanceOf(Response);
        expect(result.errorResponse.status).toBe(403);
    });

    it('returns a 403 errorResponse for an invalid profile token', async () => {
        const result = await resolveTarget({
            token: 'wrong', profileIdentifier: 'grp',
            config: { profileToken: 'p' }, allProfiles: [{ id: 'grp', enabled: true }], allMisubs: [], storageAdapter: {}
        });
        expect(result.errorResponse.status).toBe(403);
    });

    it('returns a 404 errorResponse when the profile is missing or disabled', async () => {
        const result = await resolveTarget({
            token: 'p', profileIdentifier: 'grp',
            config: { profileToken: 'p' }, allProfiles: [{ id: 'grp', enabled: false }], allMisubs: [], storageAdapter: {}
        });
        expect(result.errorResponse.status).toBe(404);
    });

    it('emits the expired placeholder node when the profile is expired', async () => {
        const result = await resolveTarget({
            token: 'p', profileIdentifier: 'grp',
            config: { profileToken: 'p' },
            allProfiles: [{ id: 'grp', name: 'Grp', enabled: true, expiresAt: '2000-01-01T00:00:00Z' }],
            allMisubs: [], storageAdapter: {}
        });
        expect(result.isProfileExpired).toBe(true);
        expect(result.subName).toBe('Grp');
        expect(result.targetMisubs).toEqual([
            { id: 'expired-node', url: EXPIRED_NODE, name: '您的订阅已到期', isExpiredNode: true }
        ]);
    });

    it('assembles profile members in order via getSubscriptionsByIds', async () => {
        const getSubscriptionsByIds = vi.fn(async () => [
            { id: 's1', url: 'https://s1.example', enabled: true },
            { id: 'm1', url: 'vmess://node', enabled: true }
        ]);
        const result = await resolveTarget({
            token: 'p', profileIdentifier: 'grp',
            config: { profileToken: 'p' },
            allProfiles: [{ id: 'grp', name: 'Grp', enabled: true, subscriptions: ['s1'], manualNodes: ['m1'] }],
            allMisubs: [], storageAdapter: { getSubscriptionsByIds }
        });
        expect(getSubscriptionsByIds).toHaveBeenCalledTimes(1);
        expect(result.targetMisubs.map(s => s.id)).toEqual(['s1', 'm1']);
    });
});

describe('resolveGenerationSettings', () => {
    function call(overrides = {}) {
        return resolveGenerationSettings({
            url: new URL(overrides.url || 'https://misub.example/token?target=clash'),
            userAgentHeader: 'ClashMeta',
            config: overrides.config || {},
            currentProfile: overrides.currentProfile ?? null,
            subName: overrides.subName || 'MiSub'
        });
    }

    it('returns a plain object with the full settings surface', () => {
        const result = call();
        expect(result).toMatchObject({
            isExternalMode: false,
            useBuiltin: true
        });
        expect(result.generationSettings).toMatchObject({ name: 'MiSub' });
        expect(Array.isArray(result.generationSettings.operators)).toBe(true);
        expect(result.templateSource).toBeTypeOf('object');
    });

    it('reads engine/template overrides from the supplied profile (single source, no extra lookup)', () => {
        const result = call({
            currentProfile: { subconverter: { engineMode: 'external' } }
        });
        expect(result.isExternalMode).toBe(true);
        expect(result.useBuiltin).toBe(false);
        expect(result.profileSub).toEqual({ engineMode: 'external' });
    });

    it('injects a rename operator from the rename URL param', () => {
        const result = call({ url: 'https://misub.example/token?target=clash&rename=HK@Hong' });
        const renameOp = result.generationSettings.operators.find(op => op.type === 'rename');
        expect(renameOp).toBeDefined();
        expect(renameOp.params.regex.rules[0]).toMatchObject({ pattern: 'HK', replacement: 'Hong' });
    });

    it('honors emoji=false by disabling flag emoji', () => {
        const result = call({ url: 'https://misub.example/token?target=clash&emoji=false' });
        expect(result.generationSettings.nodeTransform.addFlagEmoji).toBe(false);
        expect(result.generationSettings.nodeTransform.removeFlagEmoji).toBe(true);
    });
});
