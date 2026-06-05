import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAllSubscriptions = vi.fn();
const get = vi.fn();
const put = vi.fn();
const putAllSubscriptions = vi.fn();
const createAdapter = vi.fn();
const getStorageType = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
  StorageFactory: {
    createAdapter: (...args) => createAdapter(...args),
    getStorageType: (...args) => getStorageType(...args)
  }
}));

describe('_schedule.js subscription sync storage access', () => {
  beforeEach(() => {
    getAllSubscriptions.mockReset();
    get.mockReset();
    put.mockReset();
    putAllSubscriptions.mockReset();
    createAdapter.mockReset();
    getStorageType.mockReset();

    getStorageType.mockResolvedValue('d1');
    createAdapter.mockReturnValue({
      type: 'd1',
      getAllSubscriptions,
      get,
      put,
      putAllSubscriptions
    });
    getAllSubscriptions.mockResolvedValue([]);
    putAllSubscriptions.mockResolvedValue(true);
    put.mockResolvedValue(true);

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
      ok: true,
      async text() {
        return 'ss://node-one\nvmess://node-two';
      }
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads subscriptions through the StorageFactory adapter, not the legacy KV binding', async () => {
    const { performSubscriptionSync } = await import('../../functions/_schedule.js');

    getAllSubscriptions.mockResolvedValue([
      { id: 'sub-1', name: 'Sub One', url: 'https://sub.example.com', enabled: true }
    ]);

    const legacyKv = { get: vi.fn() };
    const result = await performSubscriptionSync({ KV_STORAGE: legacyKv });

    expect(getAllSubscriptions).toHaveBeenCalledTimes(1);
    expect(legacyKv.get).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalledWith('subscriptions');
    expect(result.totalSubscriptions).toBe(1);
  });

  it('refreshes node counts and persists subscriptions through the adapter', async () => {
    const { performSubscriptionSync } = await import('../../functions/_schedule.js');

    getAllSubscriptions.mockResolvedValue([
      { id: 'sub-1', name: 'Sub One', url: 'https://sub.example.com', enabled: true, nodeCount: 0 }
    ]);

    const result = await performSubscriptionSync({});

    expect(result.successfulSyncs).toBe(1);
    expect(result.failedSyncs).toBe(0);
    expect(putAllSubscriptions).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'sub-1', nodeCount: 2 })
    ]);
  });

  it('enableNodeCache 开启的订阅，定时同步成功时预热保护性缓存（原始节点）', async () => {
    const { performSubscriptionSync } = await import('../../functions/_schedule.js');

    getAllSubscriptions.mockResolvedValue([
      { id: 'sub-1', name: 'Sub One', url: 'https://sub.example.com', enabled: true, enableNodeCache: true }
    ]);

    await performSubscriptionSync({});

    expect(put).toHaveBeenCalledWith(
      'node_cache_subscription_sub-1',
      expect.objectContaining({ nodes: ['ss://node-one', 'vmess://node-two'] })
    );
  });

  it('enableNodeCache 关闭的订阅，定时同步不预热缓存', async () => {
    const { performSubscriptionSync } = await import('../../functions/_schedule.js');

    getAllSubscriptions.mockResolvedValue([
      { id: 'sub-2', name: 'Sub Two', url: 'https://sub2.example.com', enabled: true, enableNodeCache: false }
    ]);

    await performSubscriptionSync({});

    expect(put).not.toHaveBeenCalled();
  });

  it('skips disabled and non-http subscriptions', async () => {
    const { performSubscriptionSync } = await import('../../functions/_schedule.js');

    getAllSubscriptions.mockResolvedValue([
      { id: 'sub-1', name: 'Disabled', url: 'https://a.example.com', enabled: false },
      { id: 'sub-2', name: 'Manual', url: 'vmess://inline', enabled: true }
    ]);

    const result = await performSubscriptionSync({});

    expect(result.totalSubscriptions).toBe(0);
    expect(putAllSubscriptions).not.toHaveBeenCalled();
  });
});
