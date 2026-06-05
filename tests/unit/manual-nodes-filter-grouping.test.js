import { describe, expect, it } from 'vitest';
import { filterManualNodes } from '../../src/composables/manual-nodes/filters.js';
import { UNGROUPED_KEY } from '../../src/composables/manual-nodes/groups.js';

describe('filterManualNodes — 分组与未分组的区分', () => {
  it('真实名为「默认」的分组与未分组互不混淆', () => {
    const nodes = [
      { name: 'A', group: '默认', url: 'ss://a' }, // 真实分组「默认」
      { name: 'B', group: '', url: 'ss://b' },       // 未分组
    ];

    // 选「未分组」哨兵 → 只返回未分组
    expect(filterManualNodes(nodes, '', UNGROUPED_KEY).map(n => n.name)).toEqual(['B']);
    // 选真实分组「默认」 → 只返回该分组
    expect(filterManualNodes(nodes, '', '默认').map(n => n.name)).toEqual(['A']);
  });

  it('地区别名来自统一的别名表（gb → uk）', () => {
    const nodes = [{ name: 'UK-Node', group: '', url: 'ss://x' }];
    expect(filterManualNodes(nodes, 'gb', null).map(n => n.name)).toEqual(['UK-Node']);
  });
});
