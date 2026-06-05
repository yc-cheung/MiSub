/**
 * 保护性缓存节点（Protective Node Cache）
 *
 * 单机场「上次成功」的原始节点快照，机场拉取失败时供旧节点，避免节点清零。
 * 详见 docs/adr/0002-protective-node-cache-failure-semantics.md 与 CONTEXT.md。
 *
 * 设计要点：
 * - 快照存「上游原始真实节点」（未经订阅级转换/过滤/前缀），恢复时再走同一条管线。
 * - 写入是所有拉取路径共享的关注点（输出 / 预览 / 更新节点数 / 定时同步），任一成功都预热。
 * - 软失败：拉到 0 个真实节点，或节点数骤降（不足旧缓存一半），都不覆盖旧快照。
 */

const REAL_PROXY_PROTOCOLS = [
    'ss://',
    'ssr://',
    'vmess://',
    'vless://',
    'trojan://',
    'hysteria://',
    'hysteria2://',
    'hy2://',
    'tuic://',
    'anytls://',
    'socks5://',
    'socks://'
];

// 骤降阈值：新结果真实节点数低于旧快照的该比例即视为可疑（软失败）。
const SUSPICIOUS_DROP_RATIO = 0.5;

/**
 * 判断是否是真实代理节点，排除流量/到期/公告等系统伪节点
 */
export function isRealProxyNode(node) {
    if (typeof node !== 'string') return false;
    const trimmed = node.trim().toLowerCase();
    if (!trimmed) return false;
    return REAL_PROXY_PROTOCOLS.some(protocol => trimmed.startsWith(protocol));
}

/**
 * 构建单机场订阅源的保护性缓存 key
 */
export function buildSubscriptionNodeCacheKey(sub = {}) {
    const id = typeof sub.id === 'string' ? sub.id.trim() : '';
    if (id) return `node_cache_subscription_${encodeURIComponent(id)}`;

    const url = typeof sub.url === 'string' ? sub.url.trim() : '';
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
    }
    return `node_cache_subscription_url_${Math.abs(hash).toString(36)}`;
}

/**
 * 读取单机场快照，过滤掉伪节点；无可用真实节点时返回 null
 */
export async function readProtectiveNodeCache(storage, sub) {
    if (!storage?.get) return null;
    try {
        const cached = await storage.get(buildSubscriptionNodeCacheKey(sub));
        if (!cached || !Array.isArray(cached.nodes)) return null;
        // URL 变更：快照属于另一个机场，视为失效（下次成功拉取会按新 URL 覆盖）。
        // 缺失 sourceUrl 的旧快照向后兼容，不据此判失效。
        const currentUrl = typeof sub?.url === 'string' ? sub.url.trim() : '';
        if (cached.sourceUrl && currentUrl && cached.sourceUrl !== currentUrl) return null;
        const nodes = cached.nodes.filter(isRealProxyNode);
        return nodes.length > 0 ? { ...cached, nodes } : null;
    } catch (error) {
        console.warn('[ProtectiveNodeCache] Failed to read cache:', error);
        return null;
    }
}

/**
 * 低层写入：存上游原始真实节点 + 元数据。拒绝写入空真实节点。
 */
export async function writeProtectiveNodeCache(storage, sub, nodes) {
    if (!storage?.put) return false;
    const realNodes = Array.isArray(nodes) ? nodes.filter(isRealProxyNode) : [];
    if (realNodes.length === 0) return false;

    try {
        await storage.put(buildSubscriptionNodeCacheKey(sub), {
            nodes: realNodes,
            nodeCount: realNodes.length,
            updatedAt: new Date().toISOString(),
            sourceId: sub?.id || null,
            sourceName: sub?.name || '',
            sourceUrl: sub?.url || ''
        });
        return true;
    } catch (error) {
        console.warn('[ProtectiveNodeCache] Failed to write cache:', error);
        return false;
    }
}

/**
 * 是否应当用新结果覆盖旧快照。
 * - 空结果不接受；
 * - 旧快照非空且新结果骤降（不足一半）视为软失败，不接受；
 * - 其余（首次、正常波动）接受。
 */
export function shouldAcceptSnapshot(existingCount, newCount) {
    if (!(newCount > 0)) return false;
    if (existingCount > 0 && newCount < existingCount * SUSPICIOUS_DROP_RATIO) return false;
    return true;
}

/**
 * 预热/刷新快照：所有拉取成功路径共用。
 * 读旧快照 → 软失败判定 → 接受才写入。返回是否写入。
 */
export async function warmProtectiveNodeCache(storage, sub, rawNodes) {
    const realNodes = Array.isArray(rawNodes) ? rawNodes.filter(isRealProxyNode) : [];
    const existing = await readProtectiveNodeCache(storage, sub);
    const existingCount = existing?.nodes?.length || 0;
    if (!shouldAcceptSnapshot(existingCount, realNodes.length)) return false;
    return writeProtectiveNodeCache(storage, sub, realNodes);
}
