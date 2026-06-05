import { describe, expect, it } from 'vitest';
import {
    buildSubscriptionNodeCacheKey,
    shouldAcceptSnapshot,
    readProtectiveNodeCache,
    warmProtectiveNodeCache
} from '../../functions/services/protective-node-cache.js';

function createMemoryStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value) { store.set(key, value); return true; },
        async delete(key) { store.delete(key); return true; }
    };
}

const SUB = { id: 'sub-a', name: '机场A', url: 'https://example.com/sub' };

describe('protective node cache module', () => {
    describe('shouldAcceptSnapshot', () => {
        it('拒绝空结果', () => {
            expect(shouldAcceptSnapshot(10, 0)).toBe(false);
        });
        it('首次（无旧缓存）接受任意非空结果', () => {
            expect(shouldAcceptSnapshot(0, 1)).toBe(true);
        });
        it('节点数骤降（不足旧缓存一半）视为软失败，拒绝覆盖', () => {
            expect(shouldAcceptSnapshot(10, 4)).toBe(false);
        });
        it('小幅波动接受覆盖', () => {
            expect(shouldAcceptSnapshot(10, 8)).toBe(true);
            expect(shouldAcceptSnapshot(2, 1)).toBe(true);
        });
    });

    it('warmProtectiveNodeCache 写入上游原始真实节点', async () => {
        const storage = createMemoryStorage();
        const written = await warmProtectiveNodeCache(storage, SUB, ['trojan://a@h:443#A', 'trojan://b@h:443#B']);
        expect(written).toBe(true);
        const cache = await storage.get(buildSubscriptionNodeCacheKey(SUB));
        expect(cache.nodes).toEqual(['trojan://a@h:443#A', 'trojan://b@h:443#B']);
        expect(cache.nodeCount).toBe(2);
    });

    it('warmProtectiveNodeCache 在骤降时不覆盖旧缓存', async () => {
        const key = buildSubscriptionNodeCacheKey(SUB);
        const storage = createMemoryStorage({
            [key]: { nodes: ['1', '2', '3', '4'].map(n => `trojan://x@h:443#${n}`), nodeCount: 4 }
        });
        const written = await warmProtectiveNodeCache(storage, SUB, ['trojan://only@h:443#Expired']);
        expect(written).toBe(false);
        const cache = await storage.get(key);
        expect(cache.nodeCount).toBe(4);
    });

    it('warmProtectiveNodeCache 忽略伪节点，只统计真实节点', async () => {
        const storage = createMemoryStorage();
        const written = await warmProtectiveNodeCache(storage, SUB, ['127.0.0.1:8080#剩余流量', '到期：2099']);
        expect(written).toBe(false);
        expect(await storage.get(buildSubscriptionNodeCacheKey(SUB))).toBeNull();
    });

    it('readProtectiveNodeCache 读回真实节点，无真实节点返回 null', async () => {
        const key = buildSubscriptionNodeCacheKey(SUB);
        const storage = createMemoryStorage({
            [key]: { nodes: ['trojan://a@h:443#A', '127.0.0.1:8080#流量'], nodeCount: 2 }
        });
        const cache = await readProtectiveNodeCache(storage, SUB);
        expect(cache.nodes).toEqual(['trojan://a@h:443#A']);
    });

    it('readProtectiveNodeCache：快照 sourceUrl 与当前订阅 URL 不一致（机场 URL 变更）时视为失效返回 null', async () => {
        const key = buildSubscriptionNodeCacheKey(SUB);
        const storage = createMemoryStorage({
            [key]: { nodes: ['trojan://old@h:443#Old'], nodeCount: 1, sourceUrl: 'https://OLD-airport.example/sub' }
        });
        const cache = await readProtectiveNodeCache(storage, SUB);
        expect(cache).toBeNull();
    });

    it('readProtectiveNodeCache：旧快照缺失 sourceUrl 时不因 URL 判定失效（向后兼容）', async () => {
        const key = buildSubscriptionNodeCacheKey(SUB);
        const storage = createMemoryStorage({
            [key]: { nodes: ['trojan://a@h:443#A'], nodeCount: 1 }
        });
        const cache = await readProtectiveNodeCache(storage, SUB);
        expect(cache?.nodes).toEqual(['trojan://a@h:443#A']);
    });
});
