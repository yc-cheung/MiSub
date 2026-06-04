import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUIStore = defineStore('ui', () => {
  const isSettingsModalVisible = ref(false);
  const layoutMode = ref(localStorage.getItem('layoutMode') || 'modern');

  // --- Dashboard modal state ---
  // Dashboard 的跨组件弹窗可见性/载荷状态统一由 uiStore 持有，
  // 组件不再各自拥有这部分 cross-cutting visibility state。
  const showQRCodeModal = ref(false);
  const qrCodeUrl = ref('');
  const qrCodeTitle = ref('');

  const showCopyModal = ref(false);
  const showCopyModalProfile = ref(null);

  const showDeleteSubsModal = ref(false);
  const showDeleteNodesModal = ref(false);
  const showSubscriptionImportModal = ref(false);

  const showLogModal = ref(false);
  const logProfileName = ref('');

  const showBatchDeleteModal = ref(false);
  const batchDeleteIds = ref([]);

  const showDedupModal = ref(false);
  const dedupPlan = ref(null);

  const showBatchGroupModal = ref(false);
  const batchGroupIds = ref([]);

  const showNodePreviewModal = ref(false);
  const previewSubscriptionId = ref(null);
  const previewProfileId = ref(null);
  const previewSubscriptionName = ref('');
  const previewSubscriptionUrl = ref('');
  const previewProfileName = ref('');

  function show() {
    isSettingsModalVisible.value = true;
  }

  function hide() {
    isSettingsModalVisible.value = false;
  }

  function toggleLayout() {
    layoutMode.value = layoutMode.value === 'modern' ? 'legacy' : 'modern';
    localStorage.setItem('layoutMode', layoutMode.value);

    // Always redirect to root / to ensure clean state and consistent entry point
    // This handles:
    // 1. Switching to Legacy directly invokes Dashboard at /
    // 2. Switching to Modern ensures we start at Dashboard as requested
    window.location.href = '/';
  }

  return {
    isSettingsModalVisible,
    layoutMode,
    show,
    hide,
    toggleLayout,

    // Dashboard modal state
    showQRCodeModal,
    qrCodeUrl,
    qrCodeTitle,
    showCopyModal,
    showCopyModalProfile,
    showDeleteSubsModal,
    showDeleteNodesModal,
    showSubscriptionImportModal,
    showLogModal,
    logProfileName,
    showBatchDeleteModal,
    batchDeleteIds,
    showDedupModal,
    dedupPlan,
    showBatchGroupModal,
    batchGroupIds,
    showNodePreviewModal,
    previewSubscriptionId,
    previewProfileId,
    previewSubscriptionName,
    previewSubscriptionUrl,
    previewProfileName
  };
});
