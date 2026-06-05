import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { buildAutoSortedSubscriptions } from '../../src/composables/manual-nodes/sorting.js';
import { isManualNodeEntry } from '../../src/composables/manual-nodes/filters.js';
import { useManualNodes } from '../../src/composables/useManualNodes.js';
import { useDataStore } from '../../src/stores/useDataStore.js';

vi.mock('../../src/stores/toast.js', () => ({
  useToastStore: () => ({ showToast: vi.fn() })
}));

vi.mock('../../src/utils/ping.js', () => ({
  pingNode: vi.fn()
}));

// 含"中间地带"条目的混合列表：手动节点、http 订阅、未知协议节点、空 url 草稿
function makeMixedList() {
  return [
    { id: 'n1', name: '🇭🇰 HK', url: 'ss://aaa@1.1.1.1:443#HK' },        // 手动节点
    { id: 's1', name: 'Airport', url: 'https://example.com/sub' },        // http 订阅
    { id: 'n2', name: 'Juicity', url: 'juicity://xxx@2.2.2.2:443#J' },    // 未知协议（前端白名单外）
    { id: 'd1', name: '', url: '' },                                       // 空 url 草稿行
  ];
}

describe('排序/拖拽不丢数据（补集分区）', () => {
  it('buildAutoSortedSubscriptions 保留未知协议节点与空 url 草稿，不静默删除', () => {
    const all = makeMixedList();
    const manualNodes = all.filter(isManualNodeEntry); // 仅 n1

    const result = buildAutoSortedSubscriptions(all, manualNodes);

    expect(result).toHaveLength(4);
    expect(result.map(x => x.id).sort()).toEqual(['d1', 'n1', 'n2', 's1']);
  });

  it('buildAutoSortedSubscriptions 仍把手动节点排在前、其余保留在后', () => {
    const all = [
      { id: 's1', name: 'Airport', url: 'https://example.com/sub' },
      { id: 'n1', name: 'US Node', url: 'ss://aaa@1.1.1.1:443#US' },
    ];
    const result = buildAutoSortedSubscriptions(all, all.filter(isManualNodeEntry));
    expect(result[0].id).toBe('n1');
    expect(result[result.length - 1].id).toBe('s1');
  });

  it('reorderManualNodes 不丢弃未知协议节点与空草稿', () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const markDirty = vi.fn();
    const dataStore = useDataStore();
    dataStore.subscriptions = makeMixedList();

    const { manualNodes, reorderManualNodes } = useManualNodes(markDirty);
    // 模拟拖拽后的手动节点新顺序（仅 n1 是手动节点）
    reorderManualNodes([...manualNodes.value].reverse());

    expect(dataStore.subscriptions).toHaveLength(4);
    expect(dataStore.subscriptions.map(x => x.id).sort()).toEqual(['d1', 'n1', 'n2', 's1']);
  });
});
