import { beforeEach, describe, expect, it, vi } from 'vitest';

// Characterization tests for the legacy `nodeTransform` path in handleProfileMode
// (issue #7). They pin current behavior before unifying onto the operator chain:
//   - a legacy config with features routes through adaptLegacyTransform -> runOperatorChain
//   - a legacy config that is `enabled` but has no features (adapter yields zero
//     operators) leaves the nodes unchanged — the branch the applyNodeTransformPipeline
//     fallback used to serve.

const createAdapter = vi.fn();
const getStorageType = vi.fn();
const fetchSubscriptionNodes = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: (...args) => getStorageType(...args)
    }
}));

vi.mock('../../functions/modules/subscription/node-fetcher.js', () => ({
    fetchSubscriptionNodes: (...args) => fetchSubscriptionNodes(...args)
}));

function setup({ nodeTransform, settings = {}, node }) {
    createAdapter.mockReturnValue({
        getProfileById: vi.fn().mockResolvedValue({
            id: 'profile-1',
            enabled: true,
            subscriptions: ['sub-1'],
            manualNodes: [],
            nodeTransform
        }),
        getSubscriptionsByIds: vi.fn().mockResolvedValue([
            { id: 'sub-1', enabled: true, url: 'https://example.com/sub', name: 'Test Sub' }
        ]),
        get: vi.fn().mockResolvedValue(settings)
    });
    fetchSubscriptionNodes.mockResolvedValue({
        success: true,
        nodes: [node]
    });
}

async function runProfile() {
    const { handleProfileMode } = await import('../../functions/modules/subscription/profile-handler.js');
    return handleProfileMode(
        new Request('https://example.com/api/subscription_nodes'),
        {},
        'profile-1',
        'MiSub-Test/1.0',
        true,
        false
    );
}

describe('handleProfileMode legacy nodeTransform path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getStorageType.mockResolvedValue('d1');
    });

    it('applies a legacy regex rename via the operator chain', async () => {
        setup({
            nodeTransform: {
                enabled: true,
                rename: { regex: { enabled: true, rules: [{ pattern: 'Raw', replacement: 'Renamed' }] } }
            },
            node: {
                name: 'Raw Node',
                url: 'trojan://password@example.com:443#Raw%20Node',
                protocol: 'trojan',
                region: '其他',
                subscriptionName: 'Test Sub'
            }
        });

        const result = await runProfile();

        expect(result.success).toBe(true);
        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].name).toBe('Renamed Node');
        expect(result.nodes[0].url).toContain('#Renamed%20Node');
    });

    it('leaves nodes unchanged when the legacy transform is enabled but has no features', async () => {
        setup({
            nodeTransform: { enabled: true },
            node: {
                name: 'Raw Node',
                url: 'trojan://password@example.com:443#Raw%20Node',
                protocol: 'trojan',
                region: '其他',
                subscriptionName: 'Test Sub'
            }
        });

        const result = await runProfile();

        expect(result.success).toBe(true);
        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].name).toBe('Raw Node');
        expect(result.nodes[0].url).toContain('#Raw%20Node');
    });
});
