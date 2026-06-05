import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDataStore } from '../../src/stores/useDataStore.js';

// 回归：NodePreviewModal 的“保存选择”调用 dataStore.addNodes(...)，但该 action 不存在，
// 导致取节点功能静默失败（见 issue #30）。
vi.mock('../../src/stores/toast.js', () => ({
  useToastStore: () => ({ showToast: vi.fn() })
}));

describe('useDataStore.addNodes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('bulk-inserts picked nodes as manual nodes with ids and marks the store dirty', () => {
    const store = useDataStore();

    store.addNodes([
      { name: 'A', url: 'trojan://pass@a.example.com:443#A', enabled: true },
      { name: 'B', url: 'trojan://pass@b.example.com:443#B', enabled: true }
    ]);

    expect(store.subscriptions).toHaveLength(2);
    expect(store.subscriptions.every(n => typeof n.id === 'string' && n.id.length > 0)).toBe(true);
    expect(store.isDirty).toBe(true);
  });
});
