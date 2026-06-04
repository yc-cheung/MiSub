import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Characterization tests for the Telegram bot webhook handler (issue #5, HITL gate).
// This is the least-tested module in the repo; these lock in current behavior of:
//   1. the command-dispatch table (every /command + alias routes to the expected handler)
//   2. one representative command per category (list/query, mutation, import/export, binding)
//   3. the webhook entry gate (enabled / secret / permission)
// They run the real handler through its only export (handleTelegramWebhook), mocking
// StorageFactory and stubbing fetch (the Telegram transport boundary) — the same seam
// the transport adapter will later formalize.

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

function baseSettings(pushConfigExtra = {}) {
    return {
        telegram_push_config: {
            enabled: true,
            bot_token: 'BOT-TOKEN',
            webhook_secret: SECRET,
            allow_all_users: true,
            ...pushConfigExtra
        }
    };
}

function makeAdapter({ settings = baseSettings(), subscriptions = [], profiles = [] } = {}) {
    const store = { settings, subscriptions, profiles };
    return {
        store,
        get: vi.fn(async (key) => (key === 'worker_settings_v1' ? store.settings : null)),
        getAllSubscriptions: vi.fn(async () => store.subscriptions),
        getAllProfiles: vi.fn(async () => store.profiles),
        putAllSubscriptions: vi.fn(async (items) => { store.subscriptions = items; return true; }),
        putAllProfiles: vi.fn(async (items) => { store.profiles = items; return true; }),
        put: vi.fn(async (key, value) => { if (key === 'worker_settings_v1') store.settings = value; return true; })
    };
}

function stubFetch() {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        const u = String(url);
        const endpoint = u.split('/bot')[1]?.split('/')[1] || u;
        let body = null;
        try { body = JSON.parse(init?.body ?? 'null'); } catch { /* ignore */ }
        calls.push({ url: u, endpoint, body });
        return { ok: true, status: 200, clone: () => ({ text: async () => '' }), text: async () => '' };
    }));
    return calls;
}

function buildRequest(update, secret = SECRET) {
    const headers = { 'Content-Type': 'application/json' };
    if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
    return new Request('https://misub.example/api/telegram/webhook', {
        method: 'POST',
        headers,
        body: JSON.stringify(update)
    });
}

async function runWebhook(update, { state, secret = SECRET, env = { MISUB_KV: null } } = {}) {
    const adapter = makeAdapter(state || {});
    createAdapter.mockReturnValue(adapter);
    getStorageType.mockResolvedValue('kv');
    const calls = stubFetch();
    const { handleTelegramWebhook } = await import('../../functions/modules/handlers/telegram-webhook-handler.js');
    const res = await handleTelegramWebhook(buildRequest(update, secret), env);
    return { res, calls, adapter };
}

function messageUpdate(text, userId = 1, chatId = 99) {
    return { message: { from: { id: userId }, chat: { id: chatId }, text } };
}

function firstText(calls) {
    const call = calls.find(c => c.endpoint === 'sendMessage' || c.endpoint === 'editMessageText');
    return call?.body?.text ?? null;
}

describe('telegram webhook command dispatch table', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // [command, distinctive signature of the handler it must route to]
    const cases = [
        ['/start', '欢迎使用 MiSub Telegram Bot'],
        ['/help', 'MiSub Bot 命令帮助'],
        ['/menu', '快捷菜单'],
        ['/list', '暂无资源'],
        ['/stats', '统计信息'],
        ['/delete', '请指定要删除的节点'],
        ['/del', '请指定要删除的节点'],
        ['/rm', '请指定要删除的节点'],
        ['/enable', '请指定要启用的节点'],
        ['/on', '请指定要启用的节点'],
        ['/disable', '请指定要禁用的节点'],
        ['/off', '请指定要禁用的节点'],
        ['/search', '搜索节点'],
        ['/find', '搜索节点'],
        ['/sub', '暂无公开订阅组'],
        ['/subscription', '暂无公开订阅组'],
        ['/rename', '重命名节点'],
        ['/info', '查看节点详情'],
        ['/detail', '查看节点详情'],
        ['/copy', '复制节点链接'],
        ['/cp', '复制节点链接'],
        ['/export', '暂无可导出的节点'],
        ['/backup', '暂无可导出的节点'],
        ['/import', '导入节点'],
        ['/sort', '节点排序'],
        ['/dup', '暂无节点'],
        ['/dedup', '暂无节点'],
        ['/bind', '暂无订阅组'],
        ['/frobnicate', '未知命令']
    ];

    it.each(cases)('routes %s to its handler', async (command, signature) => {
        const { res, calls } = await runWebhook(messageUpdate(command));
        expect(res.status).toBe(200);
        expect(firstText(calls)).toContain(signature);
    });

    it('strips @botname suffix and is case-insensitive', async () => {
        const { calls } = await runWebhook(messageUpdate('/START@MiSubBot'));
        expect(firstText(calls)).toContain('欢迎使用 MiSub Telegram Bot');
    });

    it('routes /unbind to the unbind handler (success path when a binding exists)', async () => {
        const { calls } = await runWebhook(messageUpdate('/unbind'), {
            state: {
                settings: baseSettings({ user_bindings: { '1': 'p1' } }),
                profiles: [{ id: 'p1', name: 'Group One' }]
            }
        });
        expect(firstText(calls)).toContain('解除绑定成功');
    });
});

describe('telegram webhook — one representative command per category', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('list/query: /list renders the node list with names and count', async () => {
        const subscriptions = [
            { id: 's1', name: 'Node Alpha', url: 'vless://a@x:1', enabled: true },
            { id: 's2', name: 'Node Beta', url: 'vmess://b', enabled: false }
        ];
        const { calls } = await runWebhook(messageUpdate('/list'), { state: { subscriptions } });
        const text = firstText(calls);
        expect(text).toContain('(2 个)');
        expect(text).toContain('Node Alpha');
        expect(text).toContain('Node Beta');
    });

    it('mutation: /disable 1 flips enabled and persists via the adapter', async () => {
        const subscriptions = [{ id: 's1', name: 'Node Alpha', url: 'vless://a@x:1', enabled: true }];
        const { calls, adapter } = await runWebhook(messageUpdate('/disable 1'), { state: { subscriptions } });
        expect(adapter.putAllSubscriptions).toHaveBeenCalledTimes(1);
        expect(adapter.store.subscriptions[0].enabled).toBe(false);
        expect(firstText(calls)).toContain('已禁用 1 个节点');
    });

    it('import/export: /export url returns the raw node links', async () => {
        const subscriptions = [
            { id: 's1', name: 'Node Alpha', url: 'vless://a@x:1', enabled: true },
            { id: 's2', name: 'Node Beta', url: 'trojan://b@y:2', enabled: true }
        ];
        const { calls } = await runWebhook(messageUpdate('/export url'), { state: { subscriptions } });
        const texts = calls.filter(c => c.endpoint === 'sendMessage').map(c => c.body.text);
        expect(texts.some(t => t.includes('导出成功') && t.includes('原始链接'))).toBe(true);
        expect(texts.some(t => t.includes('vless://a@x:1') && t.includes('trojan://b@y:2'))).toBe(true);
    });

    it('binding: /bind 1 binds the profile and persists settings', async () => {
        const profiles = [{ id: 'p1', name: 'Group One' }];
        const { calls, adapter } = await runWebhook(messageUpdate('/bind 1'), { state: { profiles } });
        expect(adapter.put).toHaveBeenCalledWith('worker_settings_v1', expect.anything());
        expect(adapter.store.settings.telegram_push_config.user_bindings['1']).toBe('p1');
        expect(firstText(calls)).toContain('绑定成功');
    });
});

describe('telegram webhook entry gate', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns 403 when the bot is disabled', async () => {
        const { res } = await runWebhook(messageUpdate('/start'), {
            state: { settings: baseSettings({ enabled: false }) }
        });
        expect(res.status).toBe(403);
    });

    it('returns 401 when the webhook secret does not match', async () => {
        const { res } = await runWebhook(messageUpdate('/start'), { secret: 'wrong' });
        expect(res.status).toBe(401);
    });

    it('blocks users not on the whitelist with a permission message', async () => {
        const { res, calls } = await runWebhook(messageUpdate('/start'), {
            state: { settings: baseSettings({ allow_all_users: false, allowed_user_ids: ['42'] }) }
        });
        expect(res.status).toBe(200);
        expect(firstText(calls)).toContain('无权限使用此 Bot');
    });

    it('sends a transport message with HTML parse mode and the chat id', async () => {
        const { calls } = await runWebhook(messageUpdate('/start', 1, 12345));
        const send = calls.find(c => c.endpoint === 'sendMessage');
        expect(send.body.parse_mode).toBe('HTML');
        expect(send.body.chat_id).toBe(12345);
    });
});
