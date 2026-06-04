/**
 * API路由处理模块
 * 处理所有API请求的路由分发
 */

import { StorageFactory, DataMigrator } from '../storage-adapter.js';
import { KV_KEY_SUBS } from './config.js';
import { createJsonResponse, createErrorResponse, getAuthDebugInfo } from './utils.js';
import { authMiddleware, handleLogin, handleLogout, getAuthSessionDiagnostic, getLoginPasswordDiagnostic } from './auth-middleware.js';
import { handleDataRequest, handleMisubsSave, handleSettingsGet, handleSettingsSave, handleSettingsReset, handlePublicProfilesRequest, handlePublicConfig, handleUpdatePassword } from './api-handler.js';
import { handleRuleTemplatesRequest } from './rule-template-handler.js';
import { handleCronTrigger } from './notifications.js';
import {
    handleSubscriptionNodesRequest,
    handlePublicPreviewRequest
} from './subscription-handler.js';
import {
    handleWebdavBackupStatus,
    handleWebdavBackupTest,
    handleManualWebdavBackup,
    handleWebdavBackupList,
    handleWebdavRestore,
    handleBackupExport,
    handleBackupRestore
} from './webdav-backup-handler.js';
import {
    handleDebugSubscriptionRequest,
    handleSystemInfoRequest,
    handleStorageTestRequest,
    handleExportDataRequest,
    handlePreviewContentRequest,
    handleTestNotificationRequest
} from './handlers/debug-handler.js';
import {
    handleNodeCountRequest as handleLegacyNodeCountRequest,
    handleBatchUpdateNodesRequest,
    handleCleanNodesRequest,
    handleHealthCheckRequest
} from './handlers/node-handler.js';
import { handleClientRequest } from './handlers/client-handler.js';
import { handleErrorReportRequest } from './handlers/error-report-handler.js';
import {
    handleGuestbookGet,
    handleGuestbookPost,
    handleGuestbookManageGet,
    handleGuestbookManageAction
} from './handlers/guestbook-handler.js';
import { handleGithubReleaseRequest } from './handlers/github-proxy-handler.js'; // [NEW] Import handler
import { handleParseSubscription } from './parse-subscription-handler.js';
import { safeFetchPublicUrl, validatePublicFetchUrl, redactUrl } from './security-utils.js';
import { normalizeSubconverterBackend } from './subscription/main-handler.js';
import { maybeRunScheduledTasks } from './scheduled-task-runner.js';

// 常量定义
const OLD_KV_KEY = 'misub_data_v1';
const KV_KEY_PROFILES = 'misub_profiles_v1'; // Ensure this is defined if used
function isAuthDiagnosticsEnabled(env) {
    return String(env?.ENABLE_AUTH_DIAGNOSTICS || '').toLowerCase() === 'true';
}


/**
 * 路由表：声明式 { path/prefix, method?, auth, methods?/notAllowed?, errorWrap?, handler }。
 * 取代原先的 if 链 + 30-case switch。各路由响应体保持与重构前逐字节一致
 * （ok/success、字符串 vs 对象的 405 等不一致刻意保留，仅记录不归一化）。
 *
 * auth：'public' 无需登录 | 'required' 需登录（统一 401）| 'diagnostic' 诊断端点（关闭时 404）。
 */
const ROUTES = [
    // —— 数据迁移接口（需登录；统一错误包装：try/catch -> createErrorResponse(error, 500)）——
    { path: '/migrate_to_d1', auth: 'required', errorWrap: true, handler: async ({ env }) => {
        if (!env.MISUB_DB) {
            return createJsonResponse({ success: false, message: 'D1 数据库未配置，请检查 wrangler.toml 配置' }, 400);
        }
        const migrationResult = await DataMigrator.migrateKVToD1(env);
        if (migrationResult.errors.length > 0) {
            return createJsonResponse({ success: false, message: '迁移过程中出现错误', details: migrationResult.errors, partialSuccess: migrationResult }, 500);
        }
        return createJsonResponse({ success: true, message: '数据已成功迁移到 D1 数据库', details: migrationResult });
    } },
    { path: '/detect_legacy_d1', auth: 'required', errorWrap: true, handler: async ({ env }) => {
        const result = await DataMigrator.detectLegacyD1MainRows(env);
        return createJsonResponse({ success: true, data: result });
    } },
    { path: '/migrate_legacy_d1', auth: 'required', errorWrap: true, handler: async ({ env }) => {
        const migrationResult = await DataMigrator.migrateLegacyD1MainRows(env);
        if (migrationResult.errors.length > 0) {
            return createJsonResponse({ success: false, message: '旧 D1 结构迁移过程中出现错误', details: migrationResult.errors, partialSuccess: migrationResult }, 500);
        }
        return createJsonResponse({ success: true, message: '旧 D1 结构已成功迁移为行级存储', details: migrationResult });
    } },
    { path: '/migrate', auth: 'required', errorWrap: true, handler: async ({ env }) => {
        const kv = StorageFactory.resolveKV(env);
        if (!kv) {
            return createJsonResponse({ success: false, message: 'KV 未绑定' }, 400);
        }
        const oldData = await kv.get(OLD_KV_KEY).then(r => r ? JSON.parse(r) : null);
        const newDataRaw = await kv.get(KV_KEY_SUBS);
        if (newDataRaw !== null) {
            return createJsonResponse({ success: true, message: '无需迁移，数据已是最新结构。' }, 200);
        }
        if (!oldData) {
            return createJsonResponse({ success: false, message: '未找到需要迁移的旧数据。' }, 404);
        }
        await kv.put(KV_KEY_SUBS, JSON.stringify(oldData));
        await kv.put(KV_KEY_PROFILES, JSON.stringify([]));
        await kv.put(OLD_KV_KEY + '_migrated_on_' + new Date().toISOString(), JSON.stringify(oldData));
        await kv.delete(OLD_KV_KEY);
        return createJsonResponse({ success: true, message: '数据迁移成功！' }, 200);
    } },

    // —— 公开接口 ——
    { path: '/login', auth: 'public', handler: ({ request, env }) => handleLogin(request, env) },
    { path: ['/public_config', '/config'], auth: 'public', handler: ({ env }) => handlePublicConfig(env) },
    { path: '/public/profiles', auth: 'public', handler: ({ env }) => handlePublicProfilesRequest(env) },
    { path: '/public/preview', auth: 'public', handler: ({ request, env }) => handlePublicPreviewRequest(request, env) },
    { path: '/public/guestbook', auth: 'public', methods: ['GET', 'POST'], notAllowed: () => createErrorResponse('Method Not Allowed', 405),
      handler: ({ request, env }) => (request.method === 'GET' ? handleGuestbookGet(env) : handleGuestbookPost(request, env)) },
    { path: '/telegram/webhook', auth: 'public', handler: async ({ request, env }) => {
        const { handleTelegramWebhook } = await import('./handlers/telegram-webhook-handler.js');
        return handleTelegramWebhook(request, env);
    } },
    { path: '/system/error_report', auth: 'public', handler: ({ request, env }) => handleErrorReportRequest(request, env) },
    { prefix: '/clients', method: 'GET', auth: 'public', handler: ({ request, env }) => handleClientRequest(request, env) },
    { path: '/data', auth: 'public', handler: async ({ request, env, context }) => {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({ authenticated: false, message: 'Not logged in' });
        }
        return handleDataRequest(env, context);
    } },
    { path: '/github/release', auth: 'public', handler: ({ request, env }) => handleGithubReleaseRequest(request, env) },
    { path: '/logout', auth: 'public', handler: ({ request }) => handleLogout(request) },

    // —— 诊断端点（默认关闭：未开启时返回 404，不需登录）——
    { path: '/auth_debug', auth: 'diagnostic', handler: async ({ request, env }) => {
        const debugInfo = await getAuthDebugInfo(env);
        const authDiagnostic = await getAuthSessionDiagnostic(request, env);
        return createJsonResponse({ success: true, auth: authDiagnostic, runtime: debugInfo });
    } },
    { path: '/auth_check', auth: 'diagnostic', methods: ['POST'], notAllowed: () => createJsonResponse({ error: 'Method Not Allowed' }, 405),
      handler: async ({ request, env }) => {
        const diagnostic = await getLoginPasswordDiagnostic(request, env);
        return createJsonResponse(diagnostic, diagnostic.success ? 200 : 400);
    } },

    // —— 需登录接口 ——
    { prefix: '/clients', auth: 'required', handler: ({ request, env }) => handleClientRequest(request, env) },
    { path: '/test_notification', auth: 'required', handler: ({ request, env }) => handleTestNotificationRequest(request, env) },
    { path: '/kv_test', auth: 'required', handler: ({ env }) => handleKvTestRequest(env) },
    { path: '/misubs', auth: 'required', handler: ({ request, env }) => handleMisubsSave(request, env) },
    { path: '/rule_templates', auth: 'required', handler: ({ request, env }) => handleRuleTemplatesRequest(request, env) },
    { path: '/backup/export', auth: 'required', handler: ({ request, env }) => handleBackupExport(request, env) },
    { path: '/backup/restore', auth: 'required', handler: ({ request, env }) => handleBackupRestore(request, env) },
    { path: '/backup/webdav/status', auth: 'required', handler: ({ env }) => handleWebdavBackupStatus(env) },
    { path: '/backup/webdav/test', auth: 'required', handler: ({ request, env }) => handleWebdavBackupTest(request, env) },
    { path: '/backup/webdav/run', auth: 'required', handler: ({ request, env }) => handleManualWebdavBackup(request, env) },
    { path: '/backup/webdav/list', auth: 'required', handler: ({ request, env }) => handleWebdavBackupList(request, env) },
    { path: '/backup/webdav/restore', auth: 'required', handler: ({ request, env }) => handleWebdavRestore(request, env) },
    { path: '/node_count', auth: 'required', handler: ({ request, env }) => handleLegacyNodeCountRequest(request, env) },
    { path: '/nodes/health', auth: 'required', handler: ({ request, env }) => handleHealthCheckRequest(request, env) },
    { path: '/nodes/clean', auth: 'required', handler: ({ request, env }) => handleCleanNodesRequest(request, env) },
    { path: '/fetch_external_url', auth: 'required', handler: ({ request, env }) => handleExternalFetchRequest(request, env) },
    { path: '/batch_update_nodes', auth: 'required', handler: ({ request, env }) => handleBatchUpdateNodesRequest(request, env) },
    { path: '/subscription_nodes', auth: 'required', handler: ({ request, env }) => handleSubscriptionNodesRequest(request, env) },
    { path: '/debug_subscription', auth: 'required', handler: ({ request, env }) => handleDebugSubscriptionRequest(request, env) },
    { path: '/system/info', auth: 'required', handler: ({ request, env }) => handleSystemInfoRequest(request, env) },
    { path: '/system/storage_test', auth: 'required', handler: ({ request, env }) => handleStorageTestRequest(request, env) },
    { path: '/system/export', auth: 'required', handler: ({ request, env }) => handleExportDataRequest(request, env) },
    { path: '/preview/content', auth: 'required', handler: ({ request, env }) => handlePreviewContentRequest(request, env) },
    { path: '/parse_subscription', auth: 'required', handler: ({ request, env }) => handleParseSubscription(request, env) },
    { path: '/subconverter/test', auth: 'required', handler: ({ request, env }) => handleSubconverterTestRequest(request, env) },
    { path: '/logs', auth: 'required', methods: ['GET', 'DELETE'], notAllowed: () => createErrorResponse('Method Not Allowed', 405),
      handler: async ({ request, env }) => {
        const { LogService } = await import('../services/log-service.js');
        if (request.method === 'GET') {
            const logs = await LogService.getLogs(env);
            return createJsonResponse({ success: true, data: logs }, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' });
        }
        await LogService.clearLogs(env);
        return createJsonResponse({ success: true });
    } },
    { path: '/settings', auth: 'required', methods: ['GET', 'POST'], notAllowed: () => createJsonResponse('Method Not Allowed', 405),
      handler: ({ request, env }) => (request.method === 'GET' ? handleSettingsGet(env) : handleSettingsSave(request, env)) },
    { path: '/settings/password', auth: 'required', handler: ({ request, env }) => handleUpdatePassword(request, env) },
    { path: '/settings/reset', auth: 'required', methods: ['POST'], notAllowed: () => createErrorResponse('Method Not Allowed', 405),
      handler: ({ env }) => handleSettingsReset(env) },
    { path: '/guestbook/manage', auth: 'required', methods: ['GET', 'POST'], notAllowed: () => createErrorResponse('Method Not Allowed', 405),
      handler: ({ request, env }) => (request.method === 'GET' ? handleGuestbookManageGet(env) : handleGuestbookManageAction(request, env)) },
    { path: '/cron/status', auth: 'required', handler: ({ env }) => handleCronStatusRequest(env) },
    { path: '/cron/trigger', auth: 'required', handler: ({ env }) => handleCronTriggerRequest(env) }
];

function matchRoute(route, path, method) {
    if (route.prefix) {
        if (!path.startsWith(route.prefix)) return false;
    } else if (Array.isArray(route.path)) {
        if (!route.path.includes(path)) return false;
    } else if (route.path !== path) {
        return false;
    }
    if (route.method && route.method !== method) return false;
    return true;
}

/**
 * 处理主要的API请求
 * @param {Object} request - HTTP请求对象
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleApiRequest(request, env, context = null) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');
    const ctx = { request, env, context: context || { env }, url, path };

    for (const route of ROUTES) {
        if (!matchRoute(route, path, request.method)) continue;

        if (route.auth === 'diagnostic' && !isAuthDiagnosticsEnabled(env)) {
            return createErrorResponse('Not Found', 404);
        }
        if (route.auth === 'required' && !await authMiddleware(request, env)) {
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }
        if (route.methods && !route.methods.includes(request.method)) {
            return route.notAllowed();
        }
        if (route.errorWrap) {
            try {
                return await route.handler(ctx);
            } catch (error) {
                console.error(`[API Error ${path}]`, error);
                return createErrorResponse(error, 500);
            }
        }
        return await route.handler(ctx);
    }

    // 未匹配任何路由：保持原全局鉴权门控语义（未登录 -> 401，已登录 -> 404）
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    return createErrorResponse('API route not found', 404);
}

// KV 诊断端点处理器（测试 KV 读写是否正常；自带 try/catch，错误返回 createJsonResponse）
async function handleKvTestRequest(env) {
    try {
        const kv = StorageFactory.resolveKV(env);
        if (!kv) {
            const envKeys = env ? Object.keys(env).map(k => {
                const v = env[k];
                const t = typeof v;
                const isKVLike = v && t === 'object' && typeof v.get === 'function';
                return `${k}(${t}${isKVLike ? ',KV-like' : ''})`;
            }) : [];
            return createJsonResponse({ success: false, error: 'KV 未绑定', envKeys });
        }
        const testKey = '__kv_test_' + Date.now();
        const testValue = 'test_' + Math.random().toString(36).slice(2);

        let putError = null;
        try {
            await kv.put(testKey, testValue);
        } catch (e) {
            putError = e.message;
        }

        let readBack = null;
        let getError = null;
        try {
            readBack = await kv.get(testKey);
        } catch (e) {
            getError = e.message;
        }

        try { await kv.delete(testKey); } catch (_) {}

        let subsRaw = null;
        let subsError = null;
        try {
            subsRaw = await kv.get('misub_subscriptions_v1');
        } catch (e) {
            subsError = e.message;
        }

        let settingsRaw = null;
        try {
            settingsRaw = await kv.get('worker_settings_v1');
        } catch (_) {}

        return createJsonResponse({
            success: true,
            kvBound: true,
            writeTest: { wrote: testValue, readBack, match: readBack === testValue, putError, getError },
            actualData: {
                subscriptions: subsRaw ? `存在，长度=${subsRaw.length}` : 'null（空）',
                settings: settingsRaw ? `存在，长度=${settingsRaw.length}` : 'null（空）',
                subsError
            }
        });
    } catch (e) {
        return createJsonResponse({ success: false, error: e.message });
    }
}


export async function handleSubconverterTestRequest(request, env) {
    if (request.method !== 'POST') {
        return createErrorResponse('Method Not Allowed', 405);
    }

    let requestData;
    try {
        requestData = await request.json();
    } catch (e) {
        return createErrorResponse('Invalid JSON format', 400);
    }

    const { backend, target = 'clash', timeout = 15000 } = requestData || {};
    let endpoint;
    try {
        endpoint = normalizeSubconverterBackend(backend);
    } catch (error) {
        return createJsonResponse({
            success: false,
            error: '转换后端地址无效，请填写域名或 http(s) URL。',
            details: error.message
        }, 400);
    }

    const safeTarget = /^[a-z0-9_-]{2,32}$/i.test(String(target || '')) ? String(target).toLowerCase() : 'clash';
    const controller = new AbortController();
    const normalizedTimeout = Math.min(Math.max(Number(timeout) || 15000, 3000), 30000);
    const timeoutId = setTimeout(() => controller.abort(), normalizedTimeout);

    try {
        // 使用公开测试节点内容直接传给后端，避免探测时依赖用户订阅链接或 MiSub 回调 URL。
        endpoint.searchParams.set('target', safeTarget);
        endpoint.searchParams.set('url', 'trojan://password@example.com:443?allowInsecure=1&sni=example.com#MiSub-Test-Node');
        endpoint.searchParams.set('insert', 'false');
        endpoint.searchParams.set('emoji', 'false');
        endpoint.searchParams.set('list', 'false');
        endpoint.searchParams.set('udp', 'true');
        endpoint.searchParams.set('tfo', 'false');
        endpoint.searchParams.set('scv', 'true');
        endpoint.searchParams.set('sort', 'false');

        const startedAt = Date.now();
        const response = await fetch(new Request(endpoint.toString(), {
            method: 'GET',
            headers: {
                'User-Agent': 'MiSub/Backend-Test',
                'Accept': '*/*',
                'Cache-Control': 'no-cache'
            },
            signal: controller.signal
        }));
        const elapsedMs = Date.now() - startedAt;
        clearTimeout(timeoutId);

        const text = await response.text();
        const sample = text.slice(0, 200);
        const hasUsableOutput = response.ok && /MiSub-Test-Node|proxies:|proxy-groups:|trojan/i.test(text);

        return createJsonResponse({
            success: hasUsableOutput,
            available: hasUsableOutput,
            status: response.status,
            statusText: response.statusText,
            endpoint: `${endpoint.origin}${endpoint.pathname}`,
            elapsedMs,
            sample,
            message: hasUsableOutput
                ? `第三方转换后端可用，响应 ${response.status}，耗时 ${elapsedMs}ms。`
                : `后端已响应但未返回有效转换结果（HTTP ${response.status}）。`
        }, response.ok ? 200 : 502);
    } catch (error) {
        clearTimeout(timeoutId);
        const isTimeout = error.name === 'AbortError';
        console.error('[Subconverter Test] Error:', {
            backend: endpoint ? `${endpoint.origin}${endpoint.pathname}` : '[invalid]',
            error: error.message,
            type: isTimeout ? 'timeout' : 'network'
        });
        return createJsonResponse({
            success: false,
            available: false,
            endpoint: endpoint ? `${endpoint.origin}${endpoint.pathname}` : null,
            error: isTimeout ? `测试超时（${normalizedTimeout}ms）` : `无法连接转换后端：${error.message}`,
            errorType: isTimeout ? 'timeout' : 'network'
        }, 502);
    }
}

/**
 * 处理外部URL获取请求
 * @param {Object} request - HTTP请求对象
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleExternalFetchRequest(request, env) {
    if (request.method !== 'POST') {
        return createErrorResponse('Method Not Allowed', 405);
    }

    let requestData;
    try {
        requestData = await request.json();
    } catch (e) {
        return createErrorResponse('Invalid JSON format', 400);
    }

    const { url: externalUrl, timeout = 15000 } = requestData;

    if (!externalUrl || typeof externalUrl !== 'string') {
        return createErrorResponse('Invalid or missing URL parameter. Must be a valid HTTP/HTTPS URL.', 400);
    }

    // 检查URL长度限制
    if (externalUrl.length > 2048) {
        return createErrorResponse('URL too long (max 2048 characters)', 400);
    }

    const urlValidation = validatePublicFetchUrl(externalUrl);
    if (!urlValidation.ok) {
        return createErrorResponse(urlValidation.error, 400);
    }

    try {
        // 创建带超时的请求
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await safeFetchPublicUrl(urlValidation.url.toString(), {
            method: 'GET',
            headers: {
                'User-Agent': 'v2rayN/7.23',
                'Accept': '*/*',
                'Cache-Control': 'no-cache'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[External Fetch] HTTP ${response.status}: ${errorText.substring(0, 200)}`);

            return createJsonResponse({
                error: `Failed to fetch external URL: HTTP ${response.status} ${response.statusText}`,
                status: response.status,
                statusText: response.statusText
            }, response.status);
        }

        // 检查内容类型和大小
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB limit
            return createErrorResponse('Content too large (max 10MB limit)', 413);
        }

        const contentType = response.headers.get('content-type') || '';

        // 读取响应体并生成 Base64 兜底内容
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 10 * 1024 * 1024) { // 10MB limit
            return createErrorResponse('Response content too large (max 10MB limit)', 413);
        }

        const content = new TextDecoder('utf-8').decode(buffer);
        const contentBase64 = encodeArrayBufferToBase64(buffer);


        // 返回包含原文与 Base64 的结果
        return new Response(JSON.stringify({
            content,
            contentBase64,
            contentType,
            size: buffer.byteLength,
            url: externalUrl,
            success: true
        }), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });

    } catch (error) {
        let errorMessage = 'Unknown error occurred';
        let errorDetails = {};

        if (error.name === 'AbortError') {
            errorMessage = `Request timeout after ${timeout}ms`;
            errorDetails = { type: 'timeout', timeout };
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            errorMessage = 'Network error - unable to reach the server';
            errorDetails = { type: 'network', originalError: error.message };
        } else if (error.message.includes('DNS')) {
            errorMessage = 'DNS resolution failed';
            errorDetails = { type: 'dns', originalError: error.message };
        } else {
            errorMessage = `Request failed: ${error.message}`;
            errorDetails = { type: 'unknown', originalError: error.message };
        }

        console.error(`[External Fetch] Error:`, {
            url: redactUrl(externalUrl),
            error: error.message,
            errorType: errorDetails.type
        });

        return createErrorResponse(errorMessage, 500);
    }
}

/**
 * ArrayBuffer -> Base64 ??
 */
function encodeArrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

/**
 * 处理 Cron 状态查询请求
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
async function handleCronStatusRequest(env) {
    try {
        // 检查是否启用Cron功能
        const enableCron = env.ENABLE_CRON !== 'false';

        // 获取Cron配置
        const cronType = env.CRON_TYPE || 'hourly-subscription-sync';
        const maxSyncCount = parseInt(env.CRON_MAX_SYNC_COUNT) || 50;
        const syncTimeout = parseInt(env.CRON_SYNC_TIMEOUT) || 30000;
        const enableParallel = env.CRON_ENABLE_PARALLEL !== 'false';

        // 获取最近的Cron执行状态（如果有的话）——经适配器读取，D1-only 部署同样可用
        let lastExecution = null;
        try {
            const storageAdapter = StorageFactory.createAdapter(env, await StorageFactory.getStorageType(env));
            lastExecution = await storageAdapter.get('cron_last_execution');
        } catch (error) {
            console.warn('[Cron Status] Failed to fetch last execution:', error);
        }

        const statusData = {
            enabled: enableCron,
            config: {
                type: cronType,
                maxSyncCount,
                syncTimeout,
                enableParallel
            },
            totalSubscriptions: lastExecution?.result?.totalSubscriptions || 0,
            successfulSyncs: lastExecution?.result?.successfulSyncs || 0,
            failedSyncs: lastExecution?.result?.failedSyncs || 0,
            lastSync: lastExecution?.timestamp || null,
            details: lastExecution?.result?.details || [],
            lastExecution,
            timestamp: new Date().toISOString()
        };

        return createJsonResponse(statusData);

    } catch (error) {
        console.error('[Cron Status Error]', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * 处理 Cron 手动触发请求
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
async function handleCronTriggerRequest(env) {
    try {
        // 检查是否启用Cron功能
        const enableCron = env.ENABLE_CRON !== 'false';
        if (!enableCron) {
            return createJsonResponse({
                success: false,
                error: 'Cron functionality is disabled'
            }, 400);
        }

        // 获取Cron配置
        const cronType = env.CRON_TYPE || 'hourly-subscription-sync';
        const maxSyncCount = parseInt(env.CRON_MAX_SYNC_COUNT) || 50;
        const syncTimeout = parseInt(env.CRON_SYNC_TIMEOUT) || 30000;
        const enableParallel = env.CRON_ENABLE_PARALLEL !== 'false';

        // 调用 _schedule.js 中的同步逻辑
        const scheduleModule = await import('../_schedule.js');
        const result = await scheduleModule.performSubscriptionSync(env, {
            maxSyncCount,
            syncTimeout,
            enableParallel
        });

        // 保存执行状态——经适配器带 TTL 写入，D1-only 部署同样可用（KV 原生 TTL；D1 expires_at + 懒清理）
        try {
            const storageAdapter = StorageFactory.createAdapter(env, await StorageFactory.getStorageType(env));
            const executionStatus = {
                type: 'manual_trigger',
                cronType,
                timestamp: new Date().toISOString(),
                result: {
                    totalSubscriptions: result.totalSubscriptions,
                    successfulSyncs: result.successfulSyncs,
                    failedSyncs: result.failedSyncs
                }
            };
            await storageAdapter.putWithTTL('cron_last_execution', executionStatus, 86400);
        } catch (error) {
            console.warn('[Cron Trigger] Failed to save execution status:', error);
        }

        const scheduledTasks = await maybeRunScheduledTasks({ env }, {
            source: 'external-cron',
            forceCheck: true,
            awaitRun: true
        }).catch(error => ({ success: false, error: error?.message || String(error) }));

        return createJsonResponse({
            success: true,
            message: 'Cron triggered successfully',
            result,
            scheduledTasks,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Cron Trigger Error]', error);
        return createErrorResponse(error, 500);
    }
}
