import { describe, it, expect } from 'vitest';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';

// 回归：?include= / profile.include 之前被读取与门控、却从不实际过滤（见 issue #30）。
// include 应作为正则白名单：仅保留名称命中的节点。用手动节点（直接给 node URL）
// 驱动，避免依赖出站 fetch。
describe('include filter (regex whitelist)', () => {
    // 中性名（无国家/地区关键字），避免旗帜 emoji / 地区改名干扰名称匹配。
    const misubs = [
        { id: 'keep', name: 'keep', url: 'trojan://pass@a.example.com:443#KEEP-ME', enabled: true },
        { id: 'drop', name: 'drop', url: 'trojan://pass@b.example.com:443#DROP-ME', enabled: true }
    ];

    it('keeps only nodes whose name matches the include regex', async () => {
        const result = await generateCombinedNodeList(
            {},
            { enableAccessLog: false, include: 'KEEP' },
            'ClashMeta',
            misubs,
            '',
            { enableManualNodes: true, enableSubscriptions: true },
            false
        );
        // 按服务器主机名断言（名称会被旗帜 emoji 等转换改写，主机名不会）。
        expect(result).toContain('a.example.com');
        expect(result).not.toContain('b.example.com');
    });
});
