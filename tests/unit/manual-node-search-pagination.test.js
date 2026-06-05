import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useManualNodeSearchPagination } from '../../src/composables/manual-nodes/useManualNodeSearchPagination.js';

function setup(overrides = {}) {
  const opts = {
    manualNodes: ref([]),
    paginatedManualNodes: ref([]),
    initialSearchTerm: ref(''),
    activeGroupFilter: ref(null),
    itemsPerPage: ref(24),
    onBasePageChange: () => {},
    onSearchTermChange: () => {},
    ...overrides,
  };
  return useManualNodeSearchPagination(opts);
}

describe('useManualNodeSearchPagination', () => {
  it('搜索时仍遵守 activeGroupFilter', () => {
    const manualNodes = ref([
      { id: '1', name: 'HK-A', group: 'A', url: 'ss://1' },
      { id: '2', name: 'HK-B', group: 'B', url: 'ss://2' },
    ]);
    const { localSearchTerm, filteredNodes } = setup({
      manualNodes,
      activeGroupFilter: ref('A'),
    });

    localSearchTerm.value = 'HK';

    expect(filteredNodes.value.map(n => n.name)).toEqual(['HK-A']);
  });

  it('搜索时分页沿用 itemsPerPage，而不是写死 24', () => {
    const manualNodes = ref(
      Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `HK-${i}`, group: '', url: 'ss://x' }))
    );
    const { localSearchTerm, paginatedNodes, totalSearchPages } = setup({
      manualNodes,
      itemsPerPage: ref(48),
    });

    localSearchTerm.value = 'HK';

    expect(paginatedNodes.value).toHaveLength(30); // 48/页 → 30 条全在第一页
    expect(totalSearchPages.value).toBe(1);
  });
});
