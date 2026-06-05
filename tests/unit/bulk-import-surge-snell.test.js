import { describe, expect, it, vi } from 'vitest';
import { useBulkImportLogic } from '../../src/composables/useBulkImportLogic.js';

// toast store 依赖 Pinia，这里只验证导入分类逻辑，stub 掉 toast。
vi.mock('../../src/stores/toast.js', () => ({
  useToastStore: () => ({ showToast: () => {} })
}));

describe('handleBulkImport — Surge snell 行自动转换', () => {
  it('把 "名字 = snell, host, port, psk=..." 转换成 snell:// 节点后入库', () => {
    const addNodesFromBulk = vi.fn();
    const addSubscriptionsFromBulk = vi.fn();
    const { handleBulkImport } = useBulkImportLogic({ addSubscriptionsFromBulk, addNodesFromBulk });

    handleBulkImport('🇺🇸[BWH]MegaBox = snell, 104.224.1.1, 35517, psk=K5DGUzvNATX7VXS4lbpH, version=5, reuse=true', '');

    expect(addNodesFromBulk).toHaveBeenCalledTimes(1);
    const nodes = addNodesFromBulk.mock.calls[0][0];
    expect(nodes).toHaveLength(1);
    expect(nodes[0].url).toMatch(/^snell:\/\//);
    expect(nodes[0].url).toContain('104.224.1.1:35517');
    expect(nodes[0].name).toBe('🇺🇸[BWH]MegaBox');
  });

  it('仍把标准 snell:// 行作为节点导入', () => {
    const addNodesFromBulk = vi.fn();
    const addSubscriptionsFromBulk = vi.fn();
    const { handleBulkImport } = useBulkImportLogic({ addSubscriptionsFromBulk, addNodesFromBulk });

    handleBulkImport('snell://psk@1.2.3.4:443?version=4#HK', '');

    expect(addNodesFromBulk).toHaveBeenCalledTimes(1);
    expect(addNodesFromBulk.mock.calls[0][0][0].url).toBe('snell://psk@1.2.3.4:443?version=4#HK');
  });

  it('无法识别的行既不入库为订阅也不入库为节点', () => {
    const addNodesFromBulk = vi.fn();
    const addSubscriptionsFromBulk = vi.fn();
    const { handleBulkImport } = useBulkImportLogic({ addSubscriptionsFromBulk, addNodesFromBulk });

    handleBulkImport('this is not a node', '');

    expect(addNodesFromBulk).not.toHaveBeenCalled();
    expect(addSubscriptionsFromBulk).not.toHaveBeenCalled();
  });
});
