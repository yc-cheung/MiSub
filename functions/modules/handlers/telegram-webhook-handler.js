/**
 * Telegram Bot Webhook 入口（装配层）
 *
 * 实际逻辑已拆分到 ./telegram/ 下：
 * - shared.js     存储/配置/传输/权限/限流/用户节点等共享工具
 * - formatters.js 纯消息构建函数（可快照测试）
 * - commands.js   各命令处理器（/start /list /enable ...）
 * - callbacks.js  按钮回调分发（元数据表）
 *
 * 本文件只做：Webhook 校验 + 权限门控 + 命令路由表分发。
 */

import { createJsonResponse } from '../utils.js';
import {
    createRequestCache,
    getTelegramPushConfig,
    verifyTelegramRequest,
    checkUserPermission,
    sendTelegramMessage,
    answerCallbackQuery
} from './telegram/shared.js';
import {
    handleStartCommand,
    handleHelpCommand,
    handleMenuCommand,
    handleListCommand,
    handleStatsCommand,
    handleDeleteCommand,
    handleEnableCommand,
    handleDisableCommand,
    handleSearchCommand,
    handleSubCommand,
    handleRenameCommand,
    handleInfoCommand,
    handleCopyCommand,
    handleExportCommand,
    handleImportCommand,
    handleSortCommand,
    handleDupCommand,
    handleBindCommand,
    handleUnbindCommand,
    handleNodeInput
} from './telegram/commands.js';
import { handleCallbackQuery } from './telegram/callbacks.js';

// 命令路由表：命令（含别名）-> 处理器。ctx: { chatId, userId, args, env, request, requestCache }
const COMMAND_TABLE = {
    '/start': ({ chatId, env }) => handleStartCommand(chatId, env),
    '/help': ({ chatId, env }) => handleHelpCommand(chatId, env),
    '/menu': ({ chatId, env, requestCache }) => handleMenuCommand(chatId, env, null, requestCache),
    '/list': ({ chatId, userId, env, requestCache }) => handleListCommand(chatId, userId, env, 0, 'all', null, requestCache),
    '/stats': ({ chatId, userId, env, requestCache }) => handleStatsCommand(chatId, userId, env, requestCache),
    '/delete': ({ chatId, userId, args, env }) => handleDeleteCommand(chatId, userId, args, env),
    '/del': ({ chatId, userId, args, env }) => handleDeleteCommand(chatId, userId, args, env),
    '/rm': ({ chatId, userId, args, env }) => handleDeleteCommand(chatId, userId, args, env),
    '/enable': ({ chatId, userId, args, env }) => handleEnableCommand(chatId, userId, args, env),
    '/on': ({ chatId, userId, args, env }) => handleEnableCommand(chatId, userId, args, env),
    '/disable': ({ chatId, userId, args, env }) => handleDisableCommand(chatId, userId, args, env),
    '/off': ({ chatId, userId, args, env }) => handleDisableCommand(chatId, userId, args, env),
    '/search': ({ chatId, userId, args, env }) => handleSearchCommand(chatId, userId, args, env),
    '/find': ({ chatId, userId, args, env }) => handleSearchCommand(chatId, userId, args, env),
    '/sub': ({ chatId, args, env, request, requestCache }) => handleSubCommand(chatId, args, env, request, requestCache),
    '/subscription': ({ chatId, args, env, request, requestCache }) => handleSubCommand(chatId, args, env, request, requestCache),
    '/rename': ({ chatId, userId, args, env }) => handleRenameCommand(chatId, userId, args, env),
    '/info': ({ chatId, userId, args, env }) => handleInfoCommand(chatId, userId, args, env),
    '/detail': ({ chatId, userId, args, env }) => handleInfoCommand(chatId, userId, args, env),
    '/copy': ({ chatId, userId, args, env }) => handleCopyCommand(chatId, userId, args, env),
    '/cp': ({ chatId, userId, args, env }) => handleCopyCommand(chatId, userId, args, env),
    '/export': ({ chatId, userId, args, env }) => handleExportCommand(chatId, userId, args, env),
    '/backup': ({ chatId, userId, args, env }) => handleExportCommand(chatId, userId, args, env),
    '/import': ({ chatId, userId, args, env }) => handleImportCommand(chatId, userId, args, env),
    '/sort': ({ chatId, userId, args, env }) => handleSortCommand(chatId, userId, args, env),
    '/dup': ({ chatId, userId, args, env }) => handleDupCommand(chatId, userId, args, env),
    '/dedup': ({ chatId, userId, args, env }) => handleDupCommand(chatId, userId, args, env),
    '/bind': ({ chatId, userId, args, env, requestCache }) => handleBindCommand(chatId, userId, args, env, requestCache),
    '/unbind': ({ chatId, userId, env, requestCache }) => handleUnbindCommand(chatId, userId, env, requestCache)
};

async function handleCommand(chatId, text, userId, env, request, requestCache = null) {
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase().split('@')[0]; // 移除 @botname
    const args = parts.slice(1);

    const handler = COMMAND_TABLE[command];
    if (handler) {
        await handler({ chatId, userId, args, env, request, requestCache });
    } else {
        await sendTelegramMessage(chatId,
            '❌ 未知命令\n\n发送 /help 查看可用命令\n发送 /menu 打开快捷菜单',
            env
        );
    }

    return createJsonResponse({ ok: true });
}

export async function handleTelegramWebhook(request, env) {
    try {
        const requestCache = createRequestCache();
        const config = await getTelegramPushConfig(env, requestCache);

        if (!config.enabled) {
            return createJsonResponse({ error: 'Bot disabled' }, 403);
        }

        if (!config.webhook_secret) {
            console.error('[Telegram Push] Missing webhook secret');
            return createJsonResponse({ error: 'Webhook secret required' }, 503);
        }

        if (!(await verifyTelegramRequest(request, config))) {
            console.error('[Telegram Push] Invalid webhook secret');
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }

        const update = await request.json();

        // 按钮回调
        if (update.callback_query) {
            const userId = update.callback_query.from.id;
            const permissionCheck = checkUserPermission(userId, config);
            if (!permissionCheck.allowed) {
                await answerCallbackQuery(update.callback_query.id, permissionCheck.reason, env, true);
                return createJsonResponse({ ok: true });
            }
            return await handleCallbackQuery(update.callback_query, env, request, requestCache);
        }

        // 普通消息
        if (update.message) {
            const message = update.message;
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text;

            if (!text) {
                return createJsonResponse({ ok: true });
            }

            const permissionCheck = checkUserPermission(userId, config);
            if (!permissionCheck.allowed) {
                await sendTelegramMessage(chatId, `❌ ${permissionCheck.reason}`, env);
                return createJsonResponse({ ok: true });
            }

            if (text.startsWith('/')) {
                return await handleCommand(chatId, text, userId, env, request, requestCache);
            } else {
                return await handleNodeInput(chatId, text, userId, env, requestCache);
            }
        }

        return createJsonResponse({ ok: true });

    } catch (error) {
        console.error('[Telegram Push] Webhook handler error:', error);
        return createJsonResponse({ error: 'Internal server error' }, 500);
    }
}
