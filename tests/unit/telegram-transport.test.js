import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelegramTransport } from '../../functions/modules/handlers/telegram-transport.js';

// Unit tests for the extracted Telegram transport adapter (issue #5).
// The adapter is the single interface the webhook handler uses for all
// send / edit / answer calls; here we verify it hits the right Telegram
// endpoints with the right payloads.

describe('createTelegramTransport', () => {
    let calls;

    beforeEach(() => {
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url, init) => {
            calls.push({ url: String(url), body: JSON.parse(init.body) });
            return { ok: true, clone: () => ({ text: async () => '' }) };
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sendMessage posts to /sendMessage with HTML parse mode and merged options', async () => {
        const transport = createTelegramTransport('TKN');
        await transport.sendMessage(42, 'hello', { reply_markup: { inline_keyboard: [] } });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.telegram.org/botTKN/sendMessage');
        expect(calls[0].body).toMatchObject({
            chat_id: 42,
            text: 'hello',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
        });
    });

    it('editMessage posts to /editMessageText with the message id', async () => {
        const transport = createTelegramTransport('TKN');
        await transport.editMessage(42, 7, 'edited');

        expect(calls[0].url).toBe('https://api.telegram.org/botTKN/editMessageText');
        expect(calls[0].body).toMatchObject({ chat_id: 42, message_id: 7, text: 'edited', parse_mode: 'HTML' });
    });

    it('answerCallback posts to /answerCallbackQuery with show_alert', async () => {
        const transport = createTelegramTransport('TKN');
        await transport.answerCallback('cb-1', 'done', true);

        expect(calls[0].url).toBe('https://api.telegram.org/botTKN/answerCallbackQuery');
        expect(calls[0].body).toEqual({ callback_query_id: 'cb-1', text: 'done', show_alert: true });
    });

    it('logs but does not throw when sendMessage gets a non-ok response', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            clone: () => ({ text: async () => 'Bad Request' })
        })));

        await expect(createTelegramTransport('TKN').sendMessage(1, 'x')).resolves.toBeTruthy();
        expect(errorSpy).toHaveBeenCalledWith('[Telegram Push] Failed to send message:', 'Bad Request');
        errorSpy.mockRestore();
    });
});
