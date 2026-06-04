/**
 * Telegram Bot 处理的共享层：存储/配置访问、请求级缓存、传输封装、权限/限流、用户节点读取。
 * 命令模块（./commands/*）与回调模块（./callbacks.js）复用这些工具，handler 文件只做装配。
 */

import { StorageFactory } from '../../../storage-adapter.js';
import { KV_KEY_SETTINGS } from '../../config.js';
import { createTelegramTransport } from '../telegram-transport.js';

// ==================== 存储与配置 ====================

export async function getStorageAdapter(env) {
    const storageType = await StorageFactory.getStorageType(env);
    return StorageFactory.createAdapter(env, storageType);
}

export function createRequestCache() {
    return {
        storageAdapter: null,
        settings: undefined,
        subscriptions: undefined,
        profiles: undefined,
        telegramPushConfig: undefined,
    };
}

export async function getCachedStorageAdapter(env, cache) {
    if (!cache.storageAdapter) {
        cache.storageAdapter = await getStorageAdapter(env);
    }
    return cache.storageAdapter;
}

export async function getCachedSettings(env, cache) {
    if (cache.settings !== undefined) return cache.settings;
    const storageAdapter = await getCachedStorageAdapter(env, cache);
    cache.settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
    return cache.settings;
}

export async function getCachedSubscriptions(env, cache) {
    if (cache.subscriptions !== undefined) return cache.subscriptions;
    const storageAdapter = await getCachedStorageAdapter(env, cache);
    cache.subscriptions = await storageAdapter.getAllSubscriptions();
    return cache.subscriptions;
}

export async function getCachedProfiles(env, cache) {
    if (cache.profiles !== undefined) return cache.profiles;
    const storageAdapter = await getCachedStorageAdapter(env, cache);
    cache.profiles = await storageAdapter.getAllProfiles();
    return cache.profiles;
}

export async function persistCachedSubscriptions(env, cache) {
    if (cache.subscriptions === undefined) return;
    const storageAdapter = await getCachedStorageAdapter(env, cache);
    await storageAdapter.putAllSubscriptions(cache.subscriptions);
}

export async function persistCachedProfiles(env, cache) {
    if (cache.profiles === undefined) return;
    const storageAdapter = await getCachedStorageAdapter(env, cache);
    await storageAdapter.putAllProfiles(cache.profiles);
}

export async function persistCachedSettings(env, cache) {
    if (cache.settings === undefined) return;
    const storageAdapter = await getCachedStorageAdapter(env, cache);
    await storageAdapter.put(KV_KEY_SETTINGS, cache.settings);
}

export async function getTelegramPushConfig(env, cache = null) {
    let settings;
    if (cache) {
        settings = await getCachedSettings(env, cache);
    } else {
        const storageAdapter = await getStorageAdapter(env);
        settings = await storageAdapter.get(KV_KEY_SETTINGS) || {};
    }
    const config = settings.telegram_push_config || {};
    const allowedUserIds = Array.isArray(config.allowed_user_ids)
        ? config.allowed_user_ids
        : (env.TELEGRAM_PUSH_ALLOWED_USERS?.split(',') || []);

    return {
        enabled: config.enabled ?? true,
        bot_token: config.bot_token || env.TELEGRAM_PUSH_BOT_TOKEN,
        webhook_secret: config.webhook_secret || env.TELEGRAM_PUSH_WEBHOOK_SECRET,
        allowed_user_ids: allowedUserIds
            .map(id => id?.toString().trim())
            .filter(Boolean),
        allow_all_users: config.allow_all_users === true,
        rate_limit: config.rate_limit || {
            max_per_minute: 1000,
            max_per_day: 10000
        },
        default_profile_id: config.default_profile_id || '',
        auto_bind: config.auto_bind ?? true,
        user_bindings: (config.user_bindings && typeof config.user_bindings === 'object')
            ? config.user_bindings
            : {}
    };
}

// ==================== 工具函数 ====================

export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function extractNodeName(url) {
    try {
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
            const encoded = url.substring(hashIndex + 1);
            try {
                return decodeURIComponent(encoded);
            } catch {
                return encoded;
            }
        }
        const protocol = url.split('://')[0].toUpperCase();
        return `${protocol} 节点`;
    } catch {
        return '未命名节点';
    }
}

export function extractNodeUrls(text) {
    const protocols = [
        'ss://', 'ssr://', 'vmess://', 'vless://', 'trojan://',
        'hysteria://', 'hysteria2://', 'hy2://', 'tuic://', 'snell://',
        'anytls://', 'wireguard://', 'socks5://', 'socks5-tls://'
    ];
    const urls = [];
    const lines = text.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        const lowerTrimmed = trimmed.toLowerCase();
        for (const protocol of protocols) {
            if (lowerTrimmed.startsWith(protocol)) {
                urls.push(trimmed);
                break;
            }
        }
    }

    return urls;
}

export function parseTargetArgs(args) {
    if (!args || args.length === 0) {
        return { type: 'none', values: [] };
    }

    const arg = args.join(' ').trim().toLowerCase();

    if (arg === 'all' || arg === '全部') {
        return { type: 'all', values: [] };
    }

    const parts = arg.split(/[,，\s]+/).filter(p => p);
    const indices = [];
    const ids = [];

    for (const part of parts) {
        const num = parseInt(part);
        if (!isNaN(num) && num > 0) {
            indices.push(num - 1);
        } else {
            ids.push(part);
        }
    }

    if (indices.length > 0 && ids.length === 0) {
        return { type: 'index', values: indices };
    } else if (ids.length > 0 && indices.length === 0) {
        return { type: 'id', values: ids };
    } else if (indices.length > 0 && ids.length > 0) {
        return { type: 'mixed', indices, ids };
    }

    return { type: 'none', values: [] };
}

// ==================== Telegram API 传输封装 ====================

export async function sendTelegramMessage(chatId, text, env, options = {}) {
    try {
        const config = await getTelegramPushConfig(env, options.requestCache || null);
        if (!config.bot_token) {
            console.error('[Telegram Push] Bot token not configured');
            return;
        }
        return await createTelegramTransport(config.bot_token).sendMessage(chatId, text, options);
    } catch (error) {
        console.error('[Telegram Push] Error sending message:', error);
    }
}

export async function editTelegramMessage(chatId, messageId, text, env, options = {}) {
    try {
        const config = await getTelegramPushConfig(env, options.requestCache || null);
        if (!config.bot_token) return;
        await createTelegramTransport(config.bot_token).editMessage(chatId, messageId, text, options);
    } catch (error) {
        console.error('[Telegram Push] Error editing message:', error);
    }
}

export async function answerCallbackQuery(callbackQueryId, text, env, showAlert = false) {
    try {
        const config = await getTelegramPushConfig(env);
        if (!config.bot_token) return;
        await createTelegramTransport(config.bot_token).answerCallback(callbackQueryId, text, showAlert);
    } catch (error) {
        console.error('[Telegram Push] Error answering callback:', error);
    }
}

// ==================== 验证 / 绑定 / 权限 / 限流 ====================

export function verifyTelegramRequest(request, config) {
    const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    return secretToken === config.webhook_secret;
}

export function getUserBindingKey(userId) {
    return userId?.toString().trim();
}

export function getUserBoundProfileId(config, userId) {
    const bindingKey = getUserBindingKey(userId);
    const bindings = config?.user_bindings || {};

    if (bindingKey && Object.prototype.hasOwnProperty.call(bindings, bindingKey)) {
        return bindings[bindingKey] || '';
    }

    if (config?.auto_bind && config?.default_profile_id) {
        return config.default_profile_id;
    }

    return '';
}

export function setUserBoundProfileId(config, userId, profileId) {
    const bindingKey = getUserBindingKey(userId);
    const bindings = (config.user_bindings && typeof config.user_bindings === 'object')
        ? { ...config.user_bindings }
        : {};

    if (bindingKey) {
        bindings[bindingKey] = profileId || '';
    }

    config.user_bindings = bindings;
}

export function checkUserPermission(userId, config) {
    if (!config.enabled) {
        return { allowed: false, reason: 'Bot 已被管理员禁用' };
    }

    if (config.allow_all_users) {
        return { allowed: true };
    }

    if (!config.allowed_user_ids || config.allowed_user_ids.length === 0) {
        return { allowed: false, reason: '未配置白名单，请先在设置中添加允许用户或显式开启公开访问' };
    }

    const userIdStr = userId.toString();
    if (!config.allowed_user_ids.some(id => id.toString().trim() === userIdStr)) {
        return { allowed: false, reason: '无权限使用此 Bot，请联系管理员添加白名单' };
    }

    return { allowed: true };
}

export async function checkRateLimit(userId, env, config) {
    const minuteKey = `tg_push_rate:${userId}:min`;
    const dayKey = `tg_push_rate:${userId}:day`;

    const kv = env?.MISUB_KV || null;
    if (!kv) return { allowed: true };

    const minuteCount = parseInt(await kv.get(minuteKey) || '0');
    const dayCount = parseInt(await kv.get(dayKey) || '0');

    if (minuteCount >= config.rate_limit.max_per_minute) {
        return { allowed: false, reason: `操作过快，请1分钟后再试（${config.rate_limit.max_per_minute}/分钟）` };
    }

    if (dayCount >= config.rate_limit.max_per_day) {
        return { allowed: false, reason: `今日配额已用完（${config.rate_limit.max_per_day}/天）` };
    }

    await kv.put(minuteKey, (minuteCount + 1).toString(), { expirationTtl: 60 });
    await kv.put(dayKey, (dayCount + 1).toString(), { expirationTtl: 86400 });

    return { allowed: true };
}

// ==================== 用户节点读取 ====================

export async function getUserNodes(userId, env) {
    const storageAdapter = await getStorageAdapter(env);
    const allSubscriptions = await storageAdapter.getAllSubscriptions();

    const config = await getTelegramPushConfig(env);
    const permission = checkUserPermission(userId, config);

    if (permission.allowed) {
        return allSubscriptions;
    }

    return allSubscriptions.filter(sub =>
        sub.source === 'telegram' && sub.telegram_user_id === userId
    );
}

export async function getNodesWithMapping(userId, env) {
    const storageAdapter = await getStorageAdapter(env);
    const allSubscriptions = await storageAdapter.getAllSubscriptions();

    const config = await getTelegramPushConfig(env);
    const permission = checkUserPermission(userId, config);

    const userNodes = [];
    const indexMapping = [];

    allSubscriptions.forEach((sub, allIndex) => {
        if (permission.allowed || (sub.source === 'telegram' && sub.telegram_user_id === userId)) {
            indexMapping.push(allIndex);
            userNodes.push(sub);
        }
    });

    return { allSubscriptions, userNodes, indexMapping, storageAdapter };
}
