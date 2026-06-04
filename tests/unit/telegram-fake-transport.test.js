import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Demonstrates that the extracted transport adapter can be FAKED in tests
// (issue #5 AC): mocking telegram-transport.js lets us assert on bot output
// without touching fetch — the seam that unblocks testing the rest of the module.

const fake = vi.hoisted(() => ({ sends: [], edits: [], answers: [] }));

vi.mock('../../functions/modules/handlers/telegram-transport.js', () => ({
    createTelegramTransport: (botToken) => ({
        async sendMessage(chatId, text, options = {}) {
            fake.sends.push({ botToken, chatId, text, options });
            return { ok: true };
        },
        async editMessage(chatId, messageId, text, options = {}) {
            fake.edits.push({ botToken, chatId, messageId, text, options });
        },
        async answerCallback(callbackQueryId, text, showAlert = false) {
            fake.answers.push({ botToken, callbackQueryId, text, showAlert });
        }
    })
}));

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

describe('faking the Telegram transport in the webhook handler', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        fake.sends = [];
        fake.edits = [];
        fake.answers = [];
        getStorageType.mockResolvedValue('kv');
        createAdapter.mockReturnValue({
            get: vi.fn(async () => ({
                telegram_push_config: {
                    enabled: true,
                    bot_token: 'FAKE-TOKEN',
                    webhook_secret: SECRET,
                    allow_all_users: true
                }
            })),
            getAllSubscriptions: vi.fn(async () => []),
            getAllProfiles: vi.fn(async () => []),
            putAllSubscriptions: vi.fn(),
            putAllProfiles: vi.fn(),
            put: vi.fn()
        });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch must not be called when transport is faked'); }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes a /start command through the fake transport (no network)', async () => {
        const { handleTelegramWebhook } = await import('../../functions/modules/handlers/telegram-webhook-handler.js');
        const request = new Request('https://misub.example/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
            body: JSON.stringify({ message: { from: { id: 1 }, chat: { id: 555 }, text: '/start' } })
        });

        const res = await handleTelegramWebhook(request, { MISUB_KV: null });

        expect(res.status).toBe(200);
        expect(fake.sends).toHaveLength(1);
        expect(fake.sends[0]).toMatchObject({ botToken: 'FAKE-TOKEN', chatId: 555 });
        expect(fake.sends[0].text).toContain('欢迎使用 MiSub Telegram Bot');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
