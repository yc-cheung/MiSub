import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Characterization tests for handleCallbackQuery (button callbacks) — the part
// of the Telegram handler NOT covered by telegram-webhook-dispatch.test.js.
// Added before the #10 split so the callback-router conversion is guarded.
// Same harness: mock StorageFactory, stub fetch (transport boundary).

const createAdapter = vi.fn();
const getStorageType = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: (...args) => getStorageType(...args),
        resolveKV: () => null
    }
}));

const SECRET = 'wh-secret';

function pushConfig(extra = {}) {
    return { enabled: true, bot_token: 'BOT', webhook_secret: SECRET, allow_all_users: true, ...extra };
}

function makeAdapter({ settings, subscriptions = [], profiles = [] } = {}) {
    const store = { settings: settings || { telegram_push_config: pushConfig() }, subscriptions, profiles };
    return {
        store,
        get: vi.fn(async (key) => (key === 'worker_settings_v1' ? store.settings : null)),
        getAllSubscriptions: vi.fn(async () => store.subscriptions),
        getAllProfiles: vi.fn(async () => store.profiles),
        putAllSubscriptions: vi.fn(async (i) => { store.subscriptions = i; return true; }),
        putAllProfiles: vi.fn(async (i) => { store.profiles = i; return true; }),
        put: vi.fn(async (k, v) => { if (k === 'worker_settings_v1') store.settings = v; return true; })
    };
}

function stubFetch() {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        const u = String(url);
        const endpoint = u.split('/bot')[1]?.split('/')[1] || u;
        let body = null;
        try { body = JSON.parse(init?.body ?? 'null'); } catch { /* ignore */ }
        calls.push({ endpoint, body });
        return { ok: true, status: 200, clone: () => ({ text: async () => '' }), text: async () => '' };
    }));
    return calls;
}

async function sendCallback(data, { state, userId = 1, chatId = 5, messageId = 9 } = {}) {
    const adapter = makeAdapter(state || {});
    createAdapter.mockReturnValue(adapter);
    getStorageType.mockResolvedValue('kv');
    const calls = stubFetch();
    const { handleTelegramWebhook } = await import('../../functions/modules/handlers/telegram-webhook-handler.js');
    const update = { callback_query: { id: 'cb1', from: { id: userId }, message: { chat: { id: chatId }, message_id: messageId }, data } };
    const res = await handleTelegramWebhook(new Request('https://x/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
        body: JSON.stringify(update)
    }), { MISUB_KV: null });
    return { res, calls, adapter };
}

function textOf(calls, endpoint) {
    const c = calls.find(x => x.endpoint === endpoint);
    return c?.body?.text ?? null;
}

describe('handleCallbackQuery button flows', () => {
    beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('answers the callback and routes cmd_stats to the stats view', async () => {
        const { res, calls } = await sendCallback('cmd_stats');
        expect(res.status).toBe(200);
        expect(calls.some(c => c.endpoint === 'answerCallbackQuery')).toBe(true);
        expect(textOf(calls, 'sendMessage')).toContain('统计信息');
    });

    it('edits the message in place for cmd_menu', async () => {
        const { calls } = await sendCallback('cmd_menu');
        expect(textOf(calls, 'editMessageText')).toContain('快捷菜单');
    });

    it('routes list_page_ pagination through the list view (edit mode)', async () => {
        const { calls } = await sendCallback('list_page_1');
        expect(calls.some(c => c.endpoint === 'answerCallbackQuery')).toBe(true);
        expect(textOf(calls, 'editMessageText')).toContain('暂无资源');
    });

    it('shows a node detail panel for node_action_node_<idx>', async () => {
        const { calls } = await sendCallback('node_action_node_0', {
            state: {
                settings: { telegram_push_config: pushConfig() },
                subscriptions: [{ id: 'n1', name: 'My Node', url: 'vmess://abc', enabled: true }]
            }
        });
        const text = textOf(calls, 'editMessageText');
        expect(text).toContain('节点 #1');
        expect(text).toContain('My Node');
    });

    it('shows the delete-all confirmation dialog', async () => {
        const { calls } = await sendCallback('confirm_delete_all');
        expect(textOf(calls, 'editMessageText')).toContain('确认删除全部');
    });

    it('cancels an action', async () => {
        const { calls } = await sendCallback('cancel_action');
        const answer = calls.find(c => c.endpoint === 'answerCallbackQuery');
        expect(answer.body.text).toBe('已取消');
        expect(textOf(calls, 'editMessageText')).toContain('已取消');
    });

    it('links a node into the bound profile', async () => {
        const { calls, adapter } = await sendCallback('link_node_0', {
            state: {
                settings: { telegram_push_config: pushConfig({ user_bindings: { '1': 'p1' } }) },
                subscriptions: [{ id: 'n1', name: 'My Node', url: 'vmess://abc', enabled: true }],
                profiles: [{ id: 'p1', name: 'Group One', manualNodes: [] }]
            }
        });
        expect(adapter.store.profiles[0].manualNodes).toContain('n1');
        expect(textOf(calls, 'editMessageText')).toContain('已添加到');
    });
});
