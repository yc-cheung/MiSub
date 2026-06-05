import { computed, ref, watch } from 'vue';
import { filterManualNodes } from './filters.js';

export function useManualNodeSearchPagination(options) {
  const {
    manualNodes,
    paginatedManualNodes,
    initialSearchTerm,
    activeGroupFilter = ref(null),
    itemsPerPage = ref(24),
    onBasePageChange,
    onSearchTermChange
  } = options;

  const localSearchTerm = ref(initialSearchTerm.value || '');
  const currentSearchPage = ref(1);

  watch(initialSearchTerm, (value) => {
    const normalized = value || '';
    if (normalized !== localSearchTerm.value) {
      localSearchTerm.value = normalized;
    }
  });

  watch(localSearchTerm, (value) => {
    currentSearchPage.value = 1;
    if (typeof onSearchTermChange === 'function') {
      onSearchTermChange(value);
    }
  });

  // 单一搜索源：分组 + 搜索 + 地区别名都交给 filterManualNodes，避免与 store 级过滤逻辑漂移。
  const filteredNodes = computed(() =>
    filterManualNodes(manualNodes.value, localSearchTerm.value, activeGroupFilter.value)
  );

  // 沿用用户设置的每页条数；-1/0/非正数 视为「全部」，不分页。
  const pageSize = computed(() => {
    const n = Number(itemsPerPage.value);
    return Number.isFinite(n) && n > 0 ? n : Infinity;
  });

  const totalSearchPages = computed(() => {
    const total = Math.ceil(filteredNodes.value.length / pageSize.value);
    return total > 0 ? total : 1;
  });

  const paginatedNodes = computed(() => {
    if (!localSearchTerm.value) {
      return paginatedManualNodes.value || [];
    }

    if (pageSize.value === Infinity) {
      return filteredNodes.value;
    }

    const start = (currentSearchPage.value - 1) * pageSize.value;
    const end = start + pageSize.value;
    return filteredNodes.value.slice(start, end);
  });

  function handlePageChange(page) {
    const parsed = parseInt(page, 10);
    if (Number.isNaN(parsed)) return;

    if (localSearchTerm.value) {
      const clamped = Math.min(Math.max(parsed, 1), totalSearchPages.value);
      currentSearchPage.value = clamped;
      return;
    }

    if (typeof onBasePageChange === 'function') {
      onBasePageChange(parsed);
    }
  }

  return {
    localSearchTerm,
    filteredNodes,
    paginatedNodes,
    currentSearchPage,
    totalSearchPages,
    handlePageChange
  };
}
