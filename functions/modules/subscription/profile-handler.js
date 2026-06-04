import { StorageFactory } from '../../storage-adapter.js';
import { createJsonResponse } from '../utils.js';
import { parseNodeInfo } from '../utils/geo-utils.js';
import { calculateProtocolStats, calculateRegionStats } from '../utils/node-parser.js';
import { runOperatorChain } from '../../utils/operator-runner.js';
import { adaptLegacyTransform } from '../../utils/legacy-transform-adapter.js';
import { KV_KEY_SUBS, KV_KEY_PROFILES, KV_KEY_SETTINGS, DEFAULT_SETTINGS } from '../config.js';
import { fetchSubscriptionNodes } from './node-fetcher.js';
import { applyManualNodeName } from '../utils/node-cleaner.js';

function ensureArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

/**
 * 处理订阅组模式的节点获取
 * @param {Object} request - HTTP请求对象
 * @param {Object} env - Cloudflare环境对象
 * @param {string} profileId - 订阅组ID
 * @param {string} userAgent - 用户代理
 * @param {boolean} applyTransform - 是否应用节点转换规则（智能重命名、前缀等）
 * @returns {Promise<Object>} 处理结果
 */
export async function handleProfileMode(request, env, profileId, userAgent, applyTransform = false, skipCertVerify = false) {
    const storageAdapter = StorageFactory.createAdapter(env, await StorageFactory.getStorageType(env));

    const profile = typeof storageAdapter.getProfileById === 'function'
        ? await storageAdapter.getProfileById(profileId)
        : (await storageAdapter.get(KV_KEY_PROFILES) || []).find(p => (p.customId && p.customId === profileId) || p.id === profileId);
    const settings = await storageAdapter.get(KV_KEY_SETTINGS) || DEFAULT_SETTINGS;

    if (!profile || !profile.enabled) {
        return createJsonResponse({ error: '订阅组不存在或已禁用' }, 404);
    }

    const relatedIds = [
        ...(Array.isArray(profile.subscriptions) ? profile.subscriptions.map(item => typeof item === 'object' ? item.id : item) : []),
        ...(Array.isArray(profile.manualNodes) ? profile.manualNodes : [])
    ].filter(Boolean);
    const relatedSubs = typeof storageAdapter.getSubscriptionsByIds === 'function'
        ? await storageAdapter.getSubscriptionsByIds(Array.from(new Set(relatedIds)))
        : await storageAdapter.get(KV_KEY_SUBS) || [];
    const misubMap = new Map(relatedSubs.map(item => [item.id, item]));

    const targetMisubs = [];

    // 1. Add subscriptions in order defined by profile
    const profileSubIds = profile.subscriptions || [];
    if (Array.isArray(profileSubIds)) {
        profileSubIds.forEach(id => {
            const sub = misubMap.get(id);
            if (sub && sub.enabled && sub.url.startsWith('http')) {
                targetMisubs.push(sub);
            }
        });
    }

    // 2. Add manual nodes in order defined by profile
    const profileNodeIds = profile.manualNodes || [];
    if (Array.isArray(profileNodeIds)) {
        profileNodeIds.forEach(id => {
            const node = misubMap.get(id);
            if (node && node.enabled && !node.url.startsWith('http')) {
                targetMisubs.push(node);
            }
        });
    }

    // 分离HTTP订阅和手工节点
    const targetSubscriptions = targetMisubs.filter(item => item.url.startsWith('http'));
    const targetManualNodes = targetMisubs.filter(item => !item.url.startsWith('http'));

    // 处理手工节点（直接解析节点URL）
    // 先将用户自定义名称写入 URL（与订阅生成流程保持一致），
    // 确保 parseNodeInfo 和节点转换管道能基于正确名称工作
    const manualNodeResults = targetManualNodes.map(node => {
        const customName = typeof node.name === 'string' ? node.name.trim() : '';
        const effectiveUrl = customName ? applyManualNodeName(node.url, customName) : node.url;

        const nodeInfo = parseNodeInfo(effectiveUrl);
        return {
            subscriptionName: node.name || '手工节点',
            url: effectiveUrl,
            success: true,
            nodes: [{
                ...nodeInfo,
                url: effectiveUrl,
                subscriptionName: node.name || '手工节点'
            }],
            error: null,
            isManualNode: true
        };
    });

    // 并行获取HTTP订阅节点
    const subscriptionResults = await Promise.all(
        targetSubscriptions.map(sub => fetchSubscriptionNodes(sub.url, sub.name, userAgent, sub.customUserAgent, false, sub.exclude, sub.fetchProxy, skipCertVerify, Boolean(sub?.plusAsSpace)))
    );

    // 合并所有结果
    const allResults = [...subscriptionResults, ...manualNodeResults];

    // 统计所有节点
    const allNodes = [];
    allResults.forEach(result => {
        if (result.success) {
            allNodes.push(...result.nodes);
        }
    });

    // 如果需要应用转换规则，则处理节点名称
    let processedNodes = allNodes;
    const presetNodeTransform = profile.nodeTransformPresetId
        ? (Array.isArray(settings.nodeTransformPresets) ? settings.nodeTransformPresets.find(item => item?.id === profile.nodeTransformPresetId)?.config : null)
        : null;
    const effectiveNodeTransform = profile.nodeTransform?.enabled ? profile.nodeTransform : presetNodeTransform;

    if (applyTransform) {
        const nodeUrls = allNodes.map(node => node.url);

        let activeOperators = ensureArray(profile?.operators);
        if (!activeOperators.length && profile?.nodeTransform?.enabled && profile.nodeTransform?.operators) {
            activeOperators = ensureArray(profile.nodeTransform.operators);
        }
        if (!activeOperators.length && settings?.defaultOperators) {
            activeOperators = ensureArray(settings.defaultOperators);
        }
        if (!activeOperators.length && effectiveNodeTransform?.enabled) {
            activeOperators = adaptLegacyTransform({
                ...effectiveNodeTransform,
                enableEmoji: settings.enableFlagEmoji !== false
            });
        }

        // 旧版 nodeTransform 已在上面经 adaptLegacyTransform 统一为 operators，
        // 这里只剩 operator chain 一条管线；适配器产出空算子（启用但无任何子功能）时节点原样透传。
        let transformedUrls = nodeUrls;
        if (activeOperators.length > 0) {
            transformedUrls = await runOperatorChain(nodeUrls, activeOperators, {
                subName: profile?.name,
                userAgent,
                config: settings
            });
        }

        processedNodes = transformedUrls.map(transformedUrl => {
            const nodeInfo = parseNodeInfo(transformedUrl);
            const originalNode = allNodes.find(n => {
                try {
                    const origUrl = new URL(n.url);
                    const transUrl = new URL(transformedUrl);
                    return origUrl.hostname === transUrl.hostname && origUrl.port === transUrl.port;
                } catch {
                    return false;
                }
            });
            return {
                ...nodeInfo,
                subscriptionName: originalNode?.subscriptionName || nodeInfo.subscriptionName || '未知'
            };
        });
    }

    // 生成统计信息（使用处理后的节点）
    const protocolStats = calculateProtocolStats(processedNodes);
    const regionStats = calculateRegionStats(processedNodes);

    return {
        success: true,
        subscriptions: allResults,
        nodes: processedNodes,
        totalCount: processedNodes.length,
        stats: {
            protocols: protocolStats,
            regions: regionStats
        }
    };
}
