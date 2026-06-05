import { describe, expect, it } from 'vitest';
import { resolveAccessLogStatus } from '../../functions/services/subscription-service.js';

// 对内诚实的访问日志状态：区分「真实拉取成功」与「保护性缓存回退（软成功）」。
describe('resolveAccessLogStatus', () => {
    it('无 HTTP 订阅源（纯手动节点/过期组）记为 success', () => {
        expect(resolveAccessLogStatus(0, 0, 0)).toBe('success');
    });

    it('全部源真实拉取成功记为 success', () => {
        expect(resolveAccessLogStatus(2, 2, 2)).toBe('success');
    });

    it('全部源有内容但至少一个来自保护性缓存记为 cached', () => {
        expect(resolveAccessLogStatus(2, 2, 1)).toBe('cached'); // 1 真实 + 1 缓存
        expect(resolveAccessLogStatus(1, 1, 0)).toBe('cached'); // 唯一成员来自缓存
    });

    it('部分源有内容、部分为空记为 partial', () => {
        expect(resolveAccessLogStatus(3, 2, 1)).toBe('partial'); // 1 真实 + 1 缓存 + 1 空
        expect(resolveAccessLogStatus(2, 1, 1)).toBe('partial');
    });

    it('有源但全空记为 error', () => {
        expect(resolveAccessLogStatus(2, 0, 0)).toBe('error');
    });
});
