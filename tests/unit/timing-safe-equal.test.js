import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '../../functions/modules/security-utils.js';

// 常量时间字符串比较（双 HMAC），用于 cron / telegram webhook 密钥比较（见 issue #31）。
describe('timingSafeEqual', () => {
    it('returns true for equal strings', async () => {
        expect(await timingSafeEqual('secret-abc-123', 'secret-abc-123')).toBe(true);
    });

    it('returns false for different strings of equal length', async () => {
        expect(await timingSafeEqual('secret-abc-123', 'secret-xyz-123')).toBe(false);
    });

    it('returns false for different-length strings', async () => {
        expect(await timingSafeEqual('short', 'a-much-longer-secret')).toBe(false);
    });

    it('returns false when either input is empty or missing', async () => {
        expect(await timingSafeEqual('', 'x')).toBe(false);
        expect(await timingSafeEqual('x', undefined)).toBe(false);
        expect(await timingSafeEqual(undefined, undefined)).toBe(false);
    });
});
