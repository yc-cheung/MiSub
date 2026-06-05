// 「未分组」的内部哨兵：以 NUL(\u0000) 开头。分组名经 normalizeManualNodeGroupName 一律 trim，
// 用户也无法通过 GroupSelector 输入控制符 —— 这个 key 不会与任何真实分组名冲突。
export const UNGROUPED_KEY = '\u0000__ungrouped__';

export function normalizeManualNodeGroupName(groupName) {
  return typeof groupName === 'string' ? groupName.trim() : '';
}

export function collectManualNodeGroups(nodes) {
  const groups = new Set();
  nodes.forEach(node => {
    const group = normalizeManualNodeGroupName(node.group);
    if (group) {
      groups.add(group);
    }
  });
  return Array.from(groups).sort();
}

export function buildGroupedManualNodes(nodesToDisplay, manualNodeGroups) {
  const groups = {};
  // Initialize groups
  manualNodeGroups.forEach(group => {
    groups[group] = [];
  });
  groups[UNGROUPED_KEY] = []; // 未分组节点的专用桶（与真实分组名隔离）

  nodesToDisplay.forEach(node => {
    const groupName = normalizeManualNodeGroupName(node.group) || UNGROUPED_KEY;
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(node);
  });

  const result = {};
  Object.keys(groups).forEach(key => {
    if (groups[key].length > 0) {
      result[key] = groups[key];
    }
  });

  return result;
}
