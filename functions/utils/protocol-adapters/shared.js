/**
 * 协议适配器共享层
 *
 * 1. 低层编解码 / 解析工具（URL 查询、名称、Base64、host:port）。
 * 2. 传输层（transport）子适配器：ws / grpc / h2 / httpupgrade / xhttp / reality / quic
 *    的 `*-opts` 结构在多个协议间是一致的，这里集中实现，供各协议适配器复用，
 *    避免在每个协议里重复手写。
 */

// ============ 低层工具 ============

/** 解析 URL 查询参数（忽略 fragment 之后的内容） */
export function parseQueryParams(url) {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return new URLSearchParams();

    const hashIndex = url.indexOf('#');
    const queryString = hashIndex > queryIndex
        ? url.substring(queryIndex + 1, hashIndex)
        : url.substring(queryIndex + 1);

    // URLSearchParams 会把字面 '+' 解码成空格，破坏含 '+' 的 base64 字段
    // （WireGuard 公钥/预共享密钥、hy2 obfs-password、reality pbk）。订阅 URL 里
    // 的 '+' 基本都是 base64 字面量而非空格，故先转义为 %2B 再交给 URLSearchParams。
    return new URLSearchParams(queryString.replace(/\+/g, '%2B'));
}

/** 从 URL 的 fragment 提取节点名称 */
export function extractName(url) {
    const hashIndex = url.lastIndexOf('#');
    if (hashIndex === -1) return '';
    try {
        return decodeURIComponent(url.substring(hashIndex + 1));
    } catch {
        return url.substring(hashIndex + 1);
    }
}

/** Base64 解码（兼容 URL Safe） */
export function base64Decode(str) {
    try {
        let normalized = str.replace(/-/g, '+').replace(/_/g, '/');
        while (normalized.length % 4) normalized += '=';
        return decodeURIComponent(escape(atob(normalized)));
    } catch {
        // 回退到纯 atob
        try {
            return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        } catch {
            return str;
        }
    }
}

/** Base64 编码 */
export function base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

/** URL Safe Base64 编码（去除 padding） */
export function base64UrlSafeEncode(str) {
    return base64Encode(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 解析 server:port（支持 IPv6 [::1]:port） */
export function parseHostPort(hostPort) {
    if (hostPort.startsWith('[')) {
        const closeBracket = hostPort.indexOf(']');
        if (closeBracket !== -1) {
            const server = hostPort.substring(1, closeBracket);
            const after = hostPort.substring(closeBracket + 1);
            const port = after.startsWith(':') ? parseInt(after.substring(1)) : 443;
            return { server, port };
        }
    }

    const parts = hostPort.split(':');
    return {
        server: parts[0],
        port: parseInt(parts[1]) || 443
    };
}

/**
 * 提取 `userinfo@host:port` 主体中的 host:port 段（去掉 query / fragment）。
 * 多个协议（vless/trojan/hysteria2/tuic/wireguard/...）的解析开头完全一致。
 */
export function stripServerPart(serverPart) {
    const queryIndex = serverPart.indexOf('?');
    const hashIndex = serverPart.indexOf('#');
    if (queryIndex !== -1) {
        return serverPart.substring(0, queryIndex);
    } else if (hashIndex !== -1) {
        return serverPart.substring(0, hashIndex);
    }
    return serverPart;
}

// ============ 传输层（transport）子适配器 ============

/** ws-opts：{ path, headers: { Host } } —— vless / trojan / vmess 共用同一结构 */
export function makeWsOpts({ path, host } = {}) {
    const wsOpts = {};
    if (path) wsOpts.path = path;
    if (host) wsOpts.headers = { Host: host };
    return Object.keys(wsOpts).length > 0 ? wsOpts : null;
}

/** grpc-opts：{ 'grpc-service-name', 'grpc-mode' } */
export function makeGrpcOpts({ serviceName, mode } = {}) {
    const grpcOpts = {};
    if (serviceName) grpcOpts['grpc-service-name'] = serviceName;
    if (mode) grpcOpts['grpc-mode'] = mode;
    return Object.keys(grpcOpts).length > 0 ? grpcOpts : null;
}

/** httpupgrade-opts：{ path, host } */
export function makeHttpUpgradeOpts({ path, host } = {}) {
    const opts = {};
    if (path) opts.path = path;
    if (host) opts.host = host;
    return Object.keys(opts).length > 0 ? opts : null;
}

/** xhttp-opts：{ path, host, headers: { Host }, mode } (Loon 3.0+ / Xray 1.8.7+) */
export function makeXhttpOpts({ path, host, mode } = {}) {
    const opts = {};
    if (path) opts.path = path;
    if (host) {
        opts.host = host;
        opts.headers = { Host: host };
    }
    if (mode) opts.mode = mode;
    return Object.keys(opts).length > 0 ? opts : null;
}

/** reality-opts：{ 'public-key', 'short-id', 'spider-x' } */
export function makeRealityOpts({ publicKey, shortId, spiderX } = {}) {
    const realityOpts = {};
    if (publicKey) realityOpts['public-key'] = publicKey;
    if (shortId) realityOpts['short-id'] = shortId;
    if (spiderX) realityOpts['spider-x'] = spiderX;
    return Object.keys(realityOpts).length > 0 ? realityOpts : null;
}

/** 读取 ws-opts（兼容 'ws-opts' / wsOpts 两种字段名），返回 { path, host } */
export function readWsOpts(proxy) {
    const wsOpts = proxy['ws-opts'] || proxy.wsOpts;
    if (!wsOpts) return null;
    return { path: wsOpts.path, host: wsOpts.headers?.Host };
}
