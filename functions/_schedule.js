/**
 * Subscription Sync —— 定时刷新订阅的节点列表/数量。
 *
 * 这是 CONTEXT.md 中定义的 **Subscription Sync**：服务端发起、定时拉取上游订阅并
 * 刷新已存储的节点数量，与 **Cron Notification**（functions/modules/notifications.js
 * 中推送 Telegram 流量/到期提醒）是两个独立的任务，互不合并。
 *
 * 数据访问统一走 StorageFactory（规范绑定 + 规范数据键 KV_KEY_SUBS），
 * 以保证同步看到的就是应用持久化的同一份订阅数据。
 *
 * 注意：本文件以下划线开头，Cloudflare Pages Functions 不会将其暴露为路由；
 * `performSubscriptionSync` 由 /api/cron 手动触发处理器动态导入调用。
 */

import { StorageFactory } from './storage-adapter.js';
import { KV_KEY_SUBS, SYSTEM_CONSTANTS } from './modules/config.js';

// 与 notifications.js 中保持一致的节点协议匹配规则
const NODE_REGEX = /^(ss|ssr|vmess|vless|trojan|hysteria2?|hy|hy2|tuic|anytls|socks5|socks):\/\//gm;

async function getStorageAdapter(env) {
    const storageType = await StorageFactory.getStorageType(env);
    return StorageFactory.createAdapter(env, storageType);
}

// 通过存储适配器读取订阅：优先使用行级接口（D1），否则回退到整块 JSON（KV）。
async function loadSubscriptions(storageAdapter) {
    if (typeof storageAdapter.getAllSubscriptions === 'function') {
        const subscriptions = await storageAdapter.getAllSubscriptions();
        if (Array.isArray(subscriptions)) {
            return subscriptions;
        }
    }
    const subscriptions = await storageAdapter.get(KV_KEY_SUBS);
    return Array.isArray(subscriptions) ? subscriptions : [];
}

async function persistSubscriptions(storageAdapter, subscriptions) {
    if (typeof storageAdapter.putAllSubscriptions === 'function') {
        await storageAdapter.putAllSubscriptions(subscriptions);
        return;
    }
    await storageAdapter.put(KV_KEY_SUBS, subscriptions);
}

export async function onRequest(context) {
    // 仅在 Cron 触发时才执行
    if (context.request.headers.get('CF-Cron') !== 'true') {
        return new Response('Not a cron request', { status: 400 });
    }

    const results = {
        timestamp: new Date().toISOString(),
        subscriptionSync: null
    };

    try {
        results.subscriptionSync = await performSubscriptionSync(context.env);
    } catch (error) {
        console.error('Cron subscription sync failed:', error);
        results.subscriptionSync = { error: error.message };
    }

    return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * 执行订阅同步：刷新启用的 HTTP 订阅的节点数量并持久化。
 * @param {Object} env - Cloudflare 环境对象
 * @param {Object} [config] - 同步配置（与 /api/cron 触发处理器传入的字段对齐）
 * @param {number} [config.maxSyncCount=50] - 单次最多同步的订阅数量
 * @param {number} [config.syncTimeout=30000] - 单个订阅抓取超时（毫秒）
 * @param {boolean} [config.enableParallel=true] - 是否并发同步
 */
export async function performSubscriptionSync(env, config = {}) {
    const {
        maxSyncCount = 50,
        syncTimeout = 30000,
        enableParallel = true
    } = config;

    const concurrency = enableParallel ? 6 : 1;

    const results = {
        timestamp: new Date().toISOString(),
        totalSubscriptions: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        details: [],
        config: { maxSyncCount, syncTimeout, enableParallel }
    };

    try {
        const storageAdapter = await getStorageAdapter(env);
        const allSubscriptions = await loadSubscriptions(storageAdapter);

        // 仅同步启用的 HTTP 订阅，并受 maxSyncCount 限制
        const httpSubscriptions = allSubscriptions.filter(
            sub => typeof sub?.url === 'string' && sub.url.startsWith('http') && sub.enabled
        );
        const subscriptionsToSync = httpSubscriptions.slice(0, maxSyncCount);
        results.totalSubscriptions = subscriptionsToSync.length;

        let changesMade = false;

        const syncOne = async (subscription) => {
            try {
                const nodeCount = await syncSingleSubscription(subscription, syncTimeout);
                subscription.nodeCount = nodeCount;
                changesMade = true;
                results.successfulSyncs++;
                results.details.push({
                    name: subscription.name,
                    url: subscription.url,
                    status: 'success',
                    nodeCount
                });
            } catch (error) {
                results.failedSyncs++;
                results.details.push({
                    name: subscription.name,
                    url: subscription.url,
                    status: 'failed',
                    error: error.message
                });
            }
        };

        // 受控并发：每批 concurrency 个，避免一次性打满上游
        for (let i = 0; i < subscriptionsToSync.length; i += concurrency) {
            const batch = subscriptionsToSync.slice(i, i + concurrency);
            await Promise.all(batch.map(syncOne));
        }

        // subscriptionsToSync 中的对象是 allSubscriptions 的引用，直接整块持久化
        if (changesMade) {
            await persistSubscriptions(storageAdapter, allSubscriptions);
        }
    } catch (error) {
        console.error('Subscription sync error:', error);
        results.error = error.message;
    }

    return results;
}

/**
 * 同步单个订阅：抓取上游内容并统计节点数量。
 * @returns {Promise<number>} 最新节点数量
 */
async function syncSingleSubscription(subscription, timeout) {
    const fetchCall = fetch(new Request(subscription.url, {
        headers: { 'User-Agent': SYSTEM_CONSTANTS.FETCHER_USER_AGENT },
        redirect: 'follow'
    }));
    const response = await Promise.race([
        fetchCall,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
    ]);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    let decoded = text;
    try {
        decoded = atob(text.replace(/\s/g, ''));
    } catch {
        decoded = text;
    }

    const matches = decoded.match(NODE_REGEX);
    return matches ? matches.length : 0;
}
