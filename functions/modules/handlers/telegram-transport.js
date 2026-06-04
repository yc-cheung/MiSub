/**
 * Telegram 传输适配器
 *
 * 把对 Telegram Bot API 的 send / edit / answer 三类调用收敛到单一接口背后，
 * 这样 webhook handler 不再直接耦合 fetch，测试里可以注入一个 fake transport。
 *
 * 适配器只负责「给定 bot token 与载荷，向 Telegram 发请求」；
 * token 的解析（getTelegramPushConfig）仍由调用方负责，保持职责单一、无循环依赖。
 */

const API_BASE = 'https://api.telegram.org/bot';

/**
 * @param {string} botToken
 * @returns {{ sendMessage: Function, editMessage: Function, answerCallback: Function }}
 */
export function createTelegramTransport(botToken) {
    return {
        async sendMessage(chatId, text, options = {}) {
            const body = {
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                ...options
            };

            const response = await fetch(`${API_BASE}${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                console.error('[Telegram Push] Failed to send message:', await response.clone().text());
            }

            return response;
        },

        async editMessage(chatId, messageId, text, options = {}) {
            const body = {
                chat_id: chatId,
                message_id: messageId,
                text,
                parse_mode: 'HTML',
                ...options
            };

            await fetch(`${API_BASE}${botToken}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        },

        async answerCallback(callbackQueryId, text, showAlert = false) {
            await fetch(`${API_BASE}${botToken}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: callbackQueryId,
                    text,
                    show_alert: showAlert
                })
            });
        }
    };
}
