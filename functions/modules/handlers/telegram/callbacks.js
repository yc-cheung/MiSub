/**
 * Telegram Bot 回调（按钮）分发：用元数据表取代原来的大 switch + 前缀 if 链。
 * - CALLBACK_ACTIONS：精确匹配的静态回调（cmd_* / prompt_* / *_all 等）。
 * - CALLBACK_PREFIXES：动态前缀回调（list_page_ / node_action_ / link_* / toggle_* ... ），按原顺序匹配。
 * 各处理器函数体逐字迁自原 handleCallbackQuery，行为不变；分发顺序与原实现一致
 * （list_page_ 与静态精确匹配先于动态前缀；confirm_delete_all/do_delete_all 等精确项先于 confirm_delete_/do_delete_ 前缀）。
 */

import { escapeHtml, createJsonResponse } from '../../utils.js';
import { KV_KEY_SETTINGS } from '../../config.js';
import {
    getStorageAdapter, createRequestCache,
    getCachedSettings, getCachedProfiles, persistCachedSettings,
    sendTelegramMessage, editTelegramMessage, answerCallbackQuery,
    getUserNodes, getUserBoundProfileId, setUserBoundProfileId
} from './shared.js';
import {
    handleListCommand, handleStatsCommand, handleMenuCommand, handleSubCommandSimple,
    handleHelpCommand, handleExportCommand, handleDupCommand, handleBindCommand,
    handleEnableCommand, handleDisableCommand, handleDeleteCommand, handleCopyCommand
} from './commands.js';

// 精确匹配的静态回调。ctx: { callbackQuery, chatId, messageId, userId, data, env, requestCache }
const CALLBACK_ACTIONS = {
    async cmd_menu({ callbackQuery, chatId, messageId, env, requestCache }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleMenuCommand(chatId, env, messageId, requestCache);
    },
    async cmd_list_node({ callbackQuery, chatId, messageId, userId, env, requestCache }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleListCommand(chatId, userId, env, 0, 'node', messageId, requestCache);
    },
    async cmd_list_sub({ callbackQuery, chatId, messageId, userId, env, requestCache }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleListCommand(chatId, userId, env, 0, 'sub', messageId, requestCache);
    },
    async cmd_stats({ callbackQuery, chatId, userId, env, requestCache }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleStatsCommand(chatId, userId, env, requestCache);
    },
    async cmd_sub({ callbackQuery, chatId, env, requestCache }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleSubCommandSimple(chatId, env, requestCache);
    },
    async cmd_help({ callbackQuery, chatId, env }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleHelpCommand(chatId, env);
    },
    async cmd_export({ callbackQuery, chatId, userId, env }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleExportCommand(chatId, userId, [], env);
    },
    async cmd_dup({ callbackQuery, chatId, userId, env }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleDupCommand(chatId, userId, [], env);
    },
    async cmd_bind({ callbackQuery, chatId, userId, env, requestCache }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleBindCommand(chatId, userId, [], env, requestCache);
    },
    async prompt_import({ callbackQuery, chatId, env }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await sendTelegramMessage(chatId,
            '📥 <b>导入节点</b>\n\n请发送：\n/import <订阅链接>\n或\n/import <Base64>',
            env
        );
    },
    async prompt_sort({ callbackQuery, chatId, env }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await sendTelegramMessage(chatId,
            '🔄 <b>排序节点</b>\n\n/sort name - 按名称\n/sort protocol - 按协议\n/sort time - 按时间\n/sort status - 按状态',
            env
        );
    },
    async cmd_enable_all({ callbackQuery, chatId, userId, env }) {
        await answerCallbackQuery(callbackQuery.id, '启用中...', env);
        await handleEnableCommand(chatId, userId, ['all'], env);
    },
    async cmd_disable_all({ callbackQuery, chatId, userId, env }) {
        await answerCallbackQuery(callbackQuery.id, '禁用中...', env);
        await handleDisableCommand(chatId, userId, ['all'], env);
    },
    async confirm_delete_all({ callbackQuery, chatId, messageId, env }) {
        const confirmKeyboard = {
            inline_keyboard: [
                [
                    { text: '⚠️ 确认删除', callback_data: 'do_delete_all' },
                    { text: '❌ 取消', callback_data: 'cancel_action' }
                ]
            ]
        };
        await answerCallbackQuery(callbackQuery.id, '', env);
        await editTelegramMessage(chatId, messageId, '⚠️ <b>确认删除全部？</b>', env, { reply_markup: confirmKeyboard });
    },
    async do_delete_all({ callbackQuery, chatId, userId, env }) {
        await answerCallbackQuery(callbackQuery.id, '删除中...', env);
        await handleDeleteCommand(chatId, userId, ['all'], env);
    },
    async cancel_action({ callbackQuery, chatId, messageId, env }) {
        await answerCallbackQuery(callbackQuery.id, '已取消', env);
        await editTelegramMessage(chatId, messageId, '❌ 已取消', env);
    },
    async prompt_search({ callbackQuery, chatId, env }) {
        await answerCallbackQuery(callbackQuery.id, '', env);
        await sendTelegramMessage(chatId,
            '🔍 <b>搜索节点</b>\n\n请发送：/search <关键词>\n例：/search 香港',
            env
        );
    },
    async cmd_dup_clean({ callbackQuery, chatId, userId, env }) {
        await answerCallbackQuery(callbackQuery.id, '清理中...', env);
        await handleDupCommand(chatId, userId, ['clean'], env);
    },
    async unbind_profile({ callbackQuery, chatId, messageId, userId, env, requestCache }) {
        const cache = requestCache || createRequestCache();
        const settings = await getCachedSettings(env, cache);
        const config = settings.telegram_push_config || {};

        setUserBoundProfileId(config, userId, '');
        settings.telegram_push_config = config;
        cache.settings = settings;
        await persistCachedSettings(env, cache);

        await answerCallbackQuery(callbackQuery.id, '已解除绑定', env);
        await editTelegramMessage(chatId, messageId, '✅ 已解除绑定', env, { requestCache });
    }
};

// 动态前缀回调，按原顺序匹配（list_page_ 最先）。
const CALLBACK_PREFIXES = [
    { prefix: 'list_page_', async run({ callbackQuery, chatId, messageId, userId, data, env, requestCache }) {
        const parts = data.replace('list_page_', '').split('_');
        let type = 'all';
        let page = 0;
        if (parts.length === 2 && isNaN(parseInt(parts[0]))) {
            type = parts[0];
            page = parseInt(parts[1]);
        } else {
            page = parseInt(parts[0]);
        }
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleListCommand(chatId, userId, env, page, type, messageId, requestCache);
    } },

    { prefix: 'node_action_', async run({ callbackQuery, chatId, messageId, userId, data, env }) {
        let type = 'node';
        let idxStr = '';
        if (data.startsWith('node_action_node_')) {
            type = 'node';
            idxStr = data.replace('node_action_node_', '');
        } else if (data.startsWith('node_action_sub_')) {
            type = 'sub';
            idxStr = data.replace('node_action_sub_', '');
        } else {
            idxStr = data.replace('node_action_', '');
        }

        const idx = parseInt(idxStr);
        const storageAdapter = await getStorageAdapter(env);

        let fullList = await getUserNodes(userId, env);
        let targetList = [];
        if (type === 'sub') {
            targetList = fullList.filter(n => /^https?:\/\//i.test(n.url || ''));
        } else {
            targetList = fullList.filter(n => !/^https?:\/\//i.test(n.url || ''));
        }

        const profiles = await storageAdapter.getAllProfiles();
        const settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
        const config = settings.telegram_push_config || {};

        if (idx < 0 || idx >= targetList.length) {
            await answerCallbackQuery(callbackQuery.id, '对象不存在', env, true);
            return;
        }

        const node = targetList[idx];
        const boundProfileId = getUserBoundProfileId(config, userId);
        const boundProfile = boundProfileId
            ? profiles.find(p => p.id === boundProfileId)
            : null;

        let isInProfile = false;
        if (boundProfile) {
            if (type === 'sub') {
                isInProfile = (boundProfile.subscriptions || []).includes(node.id);
            } else {
                isInProfile = (boundProfile.manualNodes || []).includes(node.id);
            }
        }

        const protocol = (node.url || '').split('://')[0].toUpperCase();
        const typeLabel = type === 'sub' ? '订阅' : '节点';

        let message = `📋 <b>${typeLabel} #${idx + 1}</b>\n\n`;
        message += `名称: ${escapeHtml(node.name || '未命名')}\n`;
        message += `协议: ${protocol}\n`;
        message += `状态: ${node.enabled ? '✅ 启用' : '⛔ 禁用'}\n`;

        if (boundProfile) {
            message += `订阅组: ${isInProfile ? '🔗 已关联' : '未关联'}\n`;
        }

        const buttons = [];
        const toggleCmd = type === 'sub' ? `toggle_sub_${idx}` : `toggle_node_${idx}`;
        const copyCmd = type === 'sub' ? `copy_sub_${idx}` : `copy_node_${idx}`;
        buttons.push([
            { text: node.enabled ? '⛔ 禁用' : '✅ 启用', callback_data: toggleCmd },
            { text: '📋 复制', callback_data: copyCmd }
        ]);

        if (boundProfile) {
            const linkCmd = type === 'sub' ? `link_sub_${idx}` : `link_node_${idx}`;
            const unlinkCmd = type === 'sub' ? `unlink_sub_${idx}` : `unlink_node_${idx}`;
            buttons.push([{
                text: isInProfile ? '➖ 从订阅组移除' : '➕ 添加到订阅组',
                callback_data: isInProfile ? unlinkCmd : linkCmd
            }]);
        }

        const renameCmd = type === 'sub' ? `prompt_rename_sub_${idx}` : `prompt_rename_node_${idx}`;
        const deleteCmd = type === 'sub' ? `confirm_delete_sub_${idx}` : `confirm_delete_node_${idx}`;
        buttons.push([
            { text: '✏️ 重命名', callback_data: renameCmd },
            { text: '🗑️ 删除', callback_data: deleteCmd }
        ]);

        const listCmd = type === 'sub' ? 'cmd_list_sub' : 'cmd_list_node';
        buttons.push([{ text: '◀️ 返回列表', callback_data: listCmd }]);

        await answerCallbackQuery(callbackQuery.id, '', env);
        await editTelegramMessage(chatId, messageId, message, env, { reply_markup: { inline_keyboard: buttons } });
    } },

    { prefix: 'link_node_', async run({ callbackQuery, chatId, messageId, userId, data, env }) {
        const idx = parseInt(data.replace('link_node_', ''));
        const storageAdapter = await getStorageAdapter(env);
        const allNodes = await getUserNodes(userId, env);
        const userNodes = allNodes.filter(n => !/^https?:\/\//i.test(n.url || ''));
        const profiles = await storageAdapter.getAllProfiles();
        const settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
        const config = settings.telegram_push_config || {};
        const boundProfileId = getUserBoundProfileId(config, userId);
        if (idx >= 0 && idx < userNodes.length && boundProfileId) {
            const node = userNodes[idx];
            const profile = profiles.find(p => p.id === boundProfileId);
            if (profile) {
                profile.manualNodes = profile.manualNodes || [];
                if (!profile.manualNodes.includes(node.id)) {
                    profile.manualNodes.push(node.id);
                    await storageAdapter.putAllProfiles(profiles);
                }
                await answerCallbackQuery(callbackQuery.id, `已添加到 ${profile.name}`, env);
                await editTelegramMessage(chatId, messageId, `✅ 节点 #${idx + 1} 已添加到 <b>${profile.name}</b>`, env);
            }
        } else {
            await answerCallbackQuery(callbackQuery.id, '操作失败', env, true);
        }
    } },

    { prefix: 'unlink_node_', async run({ callbackQuery, chatId, messageId, userId, data, env }) {
        const idx = parseInt(data.replace('unlink_node_', ''));
        const storageAdapter = await getStorageAdapter(env);
        const allNodes = await getUserNodes(userId, env);
        const userNodes = allNodes.filter(n => !/^https?:\/\//i.test(n.url || ''));
        const profiles = await storageAdapter.getAllProfiles();
        const settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
        const config = settings.telegram_push_config || {};
        const boundProfileId = getUserBoundProfileId(config, userId);
        if (idx >= 0 && idx < userNodes.length && boundProfileId) {
            const node = userNodes[idx];
            const profile = profiles.find(p => p.id === boundProfileId);
            if (profile && profile.manualNodes) {
                profile.manualNodes = profile.manualNodes.filter(id => id !== node.id);
                await storageAdapter.putAllProfiles(profiles);
                await answerCallbackQuery(callbackQuery.id, `已从 ${profile.name} 移除`, env);
                await editTelegramMessage(chatId, messageId, `✅ 节点 #${idx + 1} 已从 <b>${profile.name}</b> 移除`, env);
            }
        } else {
            await answerCallbackQuery(callbackQuery.id, '操作失败', env, true);
        }
    } },

    { prefix: 'link_sub_', async run({ callbackQuery, chatId, messageId, userId, data, env }) {
        const idx = parseInt(data.replace('link_sub_', ''));
        const storageAdapter = await getStorageAdapter(env);
        const allNodes = await getUserNodes(userId, env);
        const subs = allNodes.filter(n => /^https?:\/\//i.test(n.url || ''));
        const profiles = await storageAdapter.getAllProfiles();
        const settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
        const config = settings.telegram_push_config || {};
        const boundProfileId = getUserBoundProfileId(config, userId);
        if (idx >= 0 && idx < subs.length && boundProfileId) {
            const sub = subs[idx];
            const profile = profiles.find(p => p.id === boundProfileId);
            if (profile) {
                profile.subscriptions = profile.subscriptions || [];
                if (!profile.subscriptions.includes(sub.id)) {
                    profile.subscriptions.push(sub.id);
                    await storageAdapter.putAllProfiles(profiles);
                }
                await answerCallbackQuery(callbackQuery.id, `已添加到 ${profile.name}`, env);
                await editTelegramMessage(chatId, messageId, `✅ 订阅 #${idx + 1} 已添加到 <b>${profile.name}</b>`, env);
            }
        } else {
            await answerCallbackQuery(callbackQuery.id, '操作失败', env, true);
        }
    } },

    { prefix: 'unlink_sub_', async run({ callbackQuery, chatId, messageId, userId, data, env }) {
        const idx = parseInt(data.replace('unlink_sub_', ''));
        const storageAdapter = await getStorageAdapter(env);
        const allNodes = await getUserNodes(userId, env);
        const subs = allNodes.filter(n => /^https?:\/\//i.test(n.url || ''));
        const profiles = await storageAdapter.getAllProfiles();
        const settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
        const config = settings.telegram_push_config || {};
        const boundProfileId = getUserBoundProfileId(config, userId);
        if (idx >= 0 && idx < subs.length && boundProfileId) {
            const sub = subs[idx];
            const profile = profiles.find(p => p.id === boundProfileId);
            if (profile && profile.subscriptions) {
                profile.subscriptions = profile.subscriptions.filter(id => id !== sub.id);
                await storageAdapter.putAllProfiles(profiles);
                await answerCallbackQuery(callbackQuery.id, `已从 ${profile.name} 移除`, env);
                await editTelegramMessage(chatId, messageId, `✅ 订阅 #${idx + 1} 已从 <b>${profile.name}</b> 移除`, env);
            }
        } else {
            await answerCallbackQuery(callbackQuery.id, '操作失败', env, true);
        }
    } },

    { prefix: 'copy_sub_', async run({ callbackQuery, chatId, userId, data, env }) {
        const idx = parseInt(data.replace('copy_sub_', ''));
        const allNodes = await getUserNodes(userId, env);
        const subs = allNodes.filter(n => /^https?:\/\//i.test(n.url || ''));
        if (idx >= 0 && idx < subs.length) {
            const subUrl = subs[idx].url;
            await answerCallbackQuery(callbackQuery.id, '已发送', env);
            await sendTelegramMessage(chatId, `📋 <b>订阅链接</b>\n\n<code>${escapeHtml(subUrl)}</code>`, env);
        } else {
            await answerCallbackQuery(callbackQuery.id, '对象不存在', env, true);
        }
    } },

    { prefix: 'copy_node_', async run({ callbackQuery, chatId, userId, data, env }) {
        const idx = parseInt(data.replace('copy_node_', ''));
        await answerCallbackQuery(callbackQuery.id, '', env);
        await handleCopyCommand(chatId, userId, [(idx + 1).toString()], env);
    } },

    { prefix: 'toggle_', match: d => d.startsWith('toggle_node_') || d.startsWith('toggle_sub_'), async run({ callbackQuery, chatId, userId, data, env }) {
        const isSub = data.startsWith('toggle_sub_');
        const idx = parseInt(data.replace(isSub ? 'toggle_sub_' : 'toggle_node_', ''));
        const storageAdapter = await getStorageAdapter(env);

        let fullList = await getUserNodes(userId, env);
        let targetList = [];
        if (isSub) {
            targetList = fullList.filter(n => /^https?:\/\//i.test(n.url || ''));
        } else {
            targetList = fullList.filter(n => !/^https?:\/\//i.test(n.url || ''));
        }

        if (idx >= 0 && idx < targetList.length) {
            const targetItem = targetList[idx];
            const isEnabled = targetItem.enabled;
            await answerCallbackQuery(callbackQuery.id, isEnabled ? '已禁用' : '已启用', env);

            if (isSub) {
                const originalSubs = await storageAdapter.getAllSubscriptions();
                const subToUpdate = originalSubs.find(s => s.id === targetItem.id);
                if (subToUpdate) {
                    subToUpdate.enabled = !isEnabled;
                    await storageAdapter.putAllSubscriptions(originalSubs);
                    await handleListCommand(chatId, userId, env, 0, 'sub');
                }
            } else {
                const allNodes = await getUserNodes(userId, env);
                const realIdx = allNodes.findIndex(n => n.id === targetItem.id);
                if (realIdx !== -1) {
                    if (isEnabled) {
                        await handleDisableCommand(chatId, userId, [(realIdx + 1).toString()], env);
                    } else {
                        await handleEnableCommand(chatId, userId, [(realIdx + 1).toString()], env);
                    }
                }
            }
        } else {
            await answerCallbackQuery(callbackQuery.id, '对象不存在', env, true);
        }
    } },

    { prefix: 'confirm_delete_', async run({ callbackQuery, chatId, messageId, data, env }) {
        let type = 'node';
        let idxStr = '';
        if (data.startsWith('confirm_delete_sub_')) {
            type = 'sub';
            idxStr = data.replace('confirm_delete_sub_', '');
        } else if (data.startsWith('confirm_delete_node_')) {
            type = 'node';
            idxStr = data.replace('confirm_delete_node_', '');
        } else {
            idxStr = data.replace('confirm_delete_', '');
        }
        const idx = parseInt(idxStr);

        const confirmKeyboard = {
            inline_keyboard: [
                [
                    { text: '⚠️ 确认删除', callback_data: `do_delete_${type}_${idx}` },
                    { text: '❌ 取消', callback_data: 'cancel_action' }
                ]
            ]
        };
        await editTelegramMessage(chatId, messageId, '⚠️ <b>确认删除此对象吗？</b>\n此操作无法撤销。', env, { reply_markup: confirmKeyboard });
    } },

    { prefix: 'do_delete_', async run({ callbackQuery, chatId, userId, data, env }) {
        let type = 'node';
        let idxStr = '';
        if (data.startsWith('do_delete_sub_')) {
            type = 'sub';
            idxStr = data.replace('do_delete_sub_', '');
        } else if (data.startsWith('do_delete_node_')) {
            type = 'node';
            idxStr = data.replace('do_delete_node_', '');
        } else {
            idxStr = data.replace('do_delete_', '');
        }
        const idx = parseInt(idxStr);

        const allNodes = await getUserNodes(userId, env);
        let targetItem = null;
        if (type === 'sub') {
            const subs = allNodes.filter(n => /^https?:\/\//i.test(n.url || ''));
            if (idx >= 0 && idx < subs.length) targetItem = subs[idx];
        } else {
            const nodes = allNodes.filter(n => !/^https?:\/\//i.test(n.url || ''));
            if (idx >= 0 && idx < nodes.length) targetItem = nodes[idx];
        }

        if (targetItem) {
            if (type === 'sub') {
                const storageAdapter = await getStorageAdapter(env);
                const originalSubs = await storageAdapter.getAllSubscriptions();
                const realIdx = originalSubs.findIndex(s => s.id === targetItem.id);
                if (realIdx !== -1) {
                    const deletedName = originalSubs[realIdx].name;
                    originalSubs.splice(realIdx, 1);
                    await storageAdapter.putAllSubscriptions(originalSubs);
                    await answerCallbackQuery(callbackQuery.id, '已删除', env);
                    await sendTelegramMessage(chatId, `🗑️ 已删除订阅: <b>${escapeHtml(deletedName)}</b>`, env);
                    await handleListCommand(chatId, userId, env, 0, 'sub');
                } else {
                    await answerCallbackQuery(callbackQuery.id, '对象不存在或已删除', env, true);
                }
            } else {
                const realIdx = allNodes.findIndex(n => n.id === targetItem.id);
                if (realIdx !== -1) {
                    await answerCallbackQuery(callbackQuery.id, '正在删除...', env);
                    await handleDeleteCommand(chatId, userId, [(realIdx + 1).toString()], env);
                }
            }
        } else {
            await answerCallbackQuery(callbackQuery.id, '对象不存在', env, true);
        }
    } },

    { prefix: 'prompt_rename_', async run({ callbackQuery, chatId, data, env }) {
        let type = 'node';
        let idxStr = '';
        if (data.startsWith('prompt_rename_sub_')) {
            type = 'sub';
            idxStr = data.replace('prompt_rename_sub_', '');
        } else if (data.startsWith('prompt_rename_node_')) {
            type = 'node';
            idxStr = data.replace('prompt_rename_node_', '');
        } else {
            idxStr = data.replace('prompt_rename_', '');
        }
        const idx = parseInt(idxStr);

        if (type === 'sub') {
            await answerCallbackQuery(callbackQuery.id, '暂不支持在 Bot 中重命名订阅', env, true);
        } else {
            await answerCallbackQuery(callbackQuery.id, '请发送新名称', env);
            await sendTelegramMessage(chatId, `请回复以下格式重命名:\n<code>/rename ${idx + 1} 新名称</code>`, env);
        }
    } },

    { prefix: 'bind_profile_', async run({ callbackQuery, chatId, messageId, userId, data, env, requestCache }) {
        const profileId = data.replace('bind_profile_', '');
        const cache = requestCache || createRequestCache();
        const profiles = await getCachedProfiles(env, cache);
        const settings = await getCachedSettings(env, cache);
        const config = settings.telegram_push_config || {};

        const targetProfile = profiles.find(p => p.id === profileId);
        if (targetProfile) {
            setUserBoundProfileId(config, userId, profileId);
            config.auto_bind = true;
            settings.telegram_push_config = config;
            cache.settings = settings;
            await persistCachedSettings(env, cache);

            await answerCallbackQuery(callbackQuery.id, `已绑定: ${targetProfile.name}`, env);
            await editTelegramMessage(chatId, messageId,
                `✅ <b>绑定成功</b>\n\n已绑定到: <b>${targetProfile.name}</b>`,
                env,
                { requestCache }
            );
        } else {
            await answerCallbackQuery(callbackQuery.id, '订阅组不存在', env, true);
        }
    } }
];

export async function handleCallbackQuery(callbackQuery, env, request, requestCache = null) {
    const ctx = {
        callbackQuery,
        chatId: callbackQuery.message.chat.id,
        messageId: callbackQuery.message.message_id,
        userId: callbackQuery.from.id,
        data: callbackQuery.data,
        env,
        requestCache
    };

    try {
        const action = CALLBACK_ACTIONS[ctx.data];
        if (action) {
            await action(ctx);
            return createJsonResponse({ ok: true });
        }

        for (const route of CALLBACK_PREFIXES) {
            const hit = route.match ? route.match(ctx.data) : ctx.data.startsWith(route.prefix);
            if (hit) {
                await route.run(ctx);
                return createJsonResponse({ ok: true });
            }
        }

        await answerCallbackQuery(callbackQuery.id, '未知操作', env);
    } catch (error) {
        console.error('[Telegram Push] Callback query failed:', error);
        await answerCallbackQuery(callbackQuery.id, '操作失败', env, true);
    }

    return createJsonResponse({ ok: true });
}
