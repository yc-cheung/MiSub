import { ref } from 'vue';
import { useToastStore } from '../stores/toast.js';
import { extractNodeName } from '../lib/utils.js';
import { generateNodeId } from '../utils/id.js';
import { normalizeNodeInput } from '../utils/protocols/normalizeNodeInput.js';

export function useNodeForms({ addNode, updateNode }) {
    const { showToast } = useToastStore();
    const showModal = ref(false);
    const isNew = ref(false);
    const editingNode = ref(null);

    const openAdd = () => {
        isNew.value = true;
        editingNode.value = {
            id: generateNodeId(),
            name: '',
            url: '',
            enabled: true,
            colorTag: null
        };
        showModal.value = true;
    };

    const openEdit = (node) => {
        if (!node) {
            console.error('UseNodeForms: openEdit called with null');
            return;
        }
        isNew.value = false;
        editingNode.value = { ...node };
        showModal.value = true;
    };

    const handleUrlInput = (event) => {
        if (!editingNode.value) return;
        const newUrl = event.target.value;
        if (newUrl && !editingNode.value.name) {
            editingNode.value.name = extractNodeName(newUrl);
        }
    };

    const handleSave = () => {
        if (!editingNode.value || !editingNode.value.url) {
            showToast('节点链接不能为空', 'error');
            return;
        }

        // 规范化输入：标准 URL 原样保留，Surge 配置行（如 "名字 = snell, ..."）转换为标准节点 URL
        const normalizedUrl = normalizeNodeInput(editingNode.value.url);
        if (!normalizedUrl) {
            showToast('无法识别的节点格式，请粘贴标准节点链接（如 snell://...）或 Surge 配置行', 'error');
            return;
        }
        editingNode.value.url = normalizedUrl;

        if (isNew.value) {
            addNode(editingNode.value);
        } else {
            updateNode(editingNode.value);
        }
        showModal.value = false;
    };

    return {
        showModal,
        isNew,
        editingNode,
        openAdd,
        openEdit,
        handleUrlInput,
        handleSave
    };
}
