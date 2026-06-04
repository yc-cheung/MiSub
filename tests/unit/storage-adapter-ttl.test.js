import { describe, it, expect, vi } from 'vitest';
import { StorageFactory, InMemoryStorageAdapter } from '../../functions/storage-adapter.js';

// Tests for issue #8: full-encapsulation storage adapter — in-memory adapter,
// withTTL on both backends, and row-level persistCollection. The in-memory
// adapter (AC4) is the deterministic place to validate TTL semantics.

describe('InMemoryStorageAdapter', () => {
    it('implements the full interface and round-trips row-level ops', async () => {
        const adapter = new InMemoryStorageAdapter();
        await adapter.putSubscription({ id: 's1', name: 'A' });
        await adapter.putProfile({ id: 'p1', customId: 'c1', name: 'P' });

        expect((await adapter.getAllSubscriptions()).map(s => s.id)).toEqual(['s1']);
        expect(await adapter.getSubscriptionById('s1')).toMatchObject({ id: 's1' });
        expect(await adapter.getSubscriptionsByIds(['s1'])).toHaveLength(1);
        expect(await adapter.getProfileById('c1')).toMatchObject({ id: 'p1' });

        await adapter.updateSubscriptionById('s1', cur => ({ ...cur, name: 'B' }));
        expect(await adapter.getSubscriptionById('s1')).toMatchObject({ name: 'B' });

        expect(await adapter.deleteSubscriptionById('s1')).toBe(true);
        expect(await adapter.getAllSubscriptions()).toEqual([]);
    });

    it('persistCollection overwrites the whole collection', async () => {
        const adapter = new InMemoryStorageAdapter({ subscriptions: [{ id: 'old' }] });
        await adapter.persistCollection('subscriptions', [{ id: 'new' }], null);
        expect((await adapter.getAllSubscriptions()).map(s => s.id)).toEqual(['new']);
    });

    it('putWithTTL expires the value after the ttl (lazy cleanup on read)', async () => {
        vi.useFakeTimers();
        try {
            const adapter = new InMemoryStorageAdapter();
            await adapter.putWithTTL('cron_last_execution', { ok: true }, 60);
            expect(await adapter.get('cron_last_execution')).toEqual({ ok: true });

            vi.advanceTimersByTime(61_000);
            expect(await adapter.get('cron_last_execution')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('KV adapter (full encapsulation)', () => {
    function kvMock() {
        const store = new Map();
        return {
            store,
            get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
            put: vi.fn(async (key, value) => { store.set(key, value); }),
            delete: vi.fn(async (key) => { store.delete(key); }),
            list: vi.fn(async () => ({ keys: [] }))
        };
    }

    it('no longer exposes .type on the public surface', () => {
        const adapter = StorageFactory.createAdapter({ MISUB_KV: kvMock() }, 'kv');
        expect(adapter.type).toBeUndefined();
    });

    it('putWithTTL forwards expirationTtl to the KV namespace', async () => {
        const kv = kvMock();
        const adapter = StorageFactory.createAdapter({ MISUB_KV: kv }, 'kv');
        await adapter.putWithTTL('cron_last_execution', { ok: 1 }, 86400);
        expect(kv.put).toHaveBeenCalledWith('cron_last_execution', JSON.stringify({ ok: 1 }), { expirationTtl: 86400 });
    });

    it('persistCollection writes the full array in one put', async () => {
        const kv = kvMock();
        const adapter = StorageFactory.createAdapter({ MISUB_KV: kv }, 'kv');
        await adapter.persistCollection('subscriptions', [{ id: 'a' }, { id: 'b' }], { added: [], updated: [], removed: ['x'] });
        // KV ignores the diff and overwrites the whole blob (atomic).
        expect(kv.store.get('misub_subscriptions_v1')).toBe(JSON.stringify([{ id: 'a' }, { id: 'b' }]));
    });
});

describe('D1 adapter TTL + row-level persistCollection', () => {
    // Minimal D1 mock: settings (with expires_at) + subscriptions row ops.
    function d1Mock({ now = 0, subscriptions = [] } = {}) {
        const settings = new Map(); // key -> { value, expires_at }
        const subs = new Map(subscriptions.map(s => [s.id, JSON.stringify(s)]));
        return {
            settings,
            subs,
            prepare(sql) {
                return {
                    async all() {
                        if (sql.includes('SELECT data FROM subscriptions')) {
                            return { results: Array.from(subs.values()).map(data => ({ data })) };
                        }
                        return { results: [] };
                    },
                    async run() { return { success: true }; },
                    bind(...args) {
                        return {
                            async first() {
                                if (sql.includes('value as data, expires_at FROM settings')) {
                                    const row = settings.get(args[0]);
                                    return row ? { data: row.value, expires_at: row.expires_at ?? null } : null;
                                }
                                if (sql.includes('value as data FROM settings')) {
                                    const row = settings.get(args[0]);
                                    return row ? { data: row.value } : null;
                                }
                                if (sql.includes('FROM subscriptions WHERE id = ?')) {
                                    const data = subs.get(args[0]);
                                    return data ? { data } : null;
                                }
                                return null;
                            },
                            async all() {
                                if (sql.includes('FROM subscriptions WHERE id IN')) {
                                    return { results: args.filter(id => subs.has(id)).map(id => ({ data: subs.get(id) })) };
                                }
                                return { results: [] };
                            },
                            async run() {
                                if (sql.includes('INSERT OR REPLACE INTO settings')) {
                                    // (key, value, expires_at, ...)
                                    settings.set(args[0], { value: args[1], expires_at: args[2] ?? null });
                                }
                                if (sql.includes('INSERT OR REPLACE INTO subscriptions')) {
                                    subs.set(args[0], args[1]);
                                }
                                if (sql.includes('DELETE FROM settings')) settings.delete(args[0]);
                                if (sql.includes('DELETE FROM subscriptions')) subs.delete(args[0]);
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };
    }

    it('putWithTTL stores expires_at and get lazily cleans it up', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        try {
            const db = d1Mock();
            const adapter = StorageFactory.createAdapter({ MISUB_DB: db }, 'd1');

            await adapter.putWithTTL('cron_last_execution', { ok: 1 }, 60);
            expect(db.settings.get('cron_last_execution').expires_at).toBe(1_000_000 + 60_000);
            expect(await adapter.get('cron_last_execution')).toEqual({ ok: 1 });

            vi.setSystemTime(1_000_000 + 61_000);
            expect(await adapter.get('cron_last_execution')).toBeNull();
            expect(db.settings.has('cron_last_execution')).toBe(false); // lazily deleted
        } finally {
            vi.useRealTimers();
        }
    });

    it('persistCollection applies a simple diff row-by-row', async () => {
        const db = d1Mock({ subscriptions: [{ id: 's-keep' }, { id: 's-del' }] });
        const adapter = StorageFactory.createAdapter({ MISUB_DB: db }, 'd1');

        await adapter.persistCollection('subscriptions', [], {
            added: [{ id: 's-new' }],
            updated: [{ id: 's-keep', v: 2 }],
            removed: ['s-del']
        });

        expect(JSON.parse(db.subs.get('s-new'))).toMatchObject({ id: 's-new' });
        expect(JSON.parse(db.subs.get('s-keep'))).toMatchObject({ id: 's-keep', v: 2 });
        expect(db.subs.has('s-del')).toBe(false);
    });

    it('persistCollection without a diff syncs current vs final', async () => {
        const db = d1Mock({ subscriptions: [{ id: 's-legacy' }] });
        const adapter = StorageFactory.createAdapter({ MISUB_DB: db }, 'd1');

        await adapter.persistCollection('subscriptions', [{ id: 's-new' }], null);

        expect(db.subs.has('s-new')).toBe(true);
        expect(db.subs.has('s-legacy')).toBe(false);
    });
});
