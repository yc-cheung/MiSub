/**
 * 协议适配器注册表（后端）
 *
 * 每个协议一个适配器：`{ key, schemes, types, parse(url)->record, build(proxy)->url }`。
 * - `schemes`：URL scheme（如 ss / vmess / hy2），用于 url→record 的分发。
 * - `types`：Clash proxy.type（如 ss / shadowsocks），用于 record→url 的分发。
 * 解析与生成不再用 15 分支 if 链，而是按协议键查表分发（见文件末尾的 urlToProxy / proxyToUrl）。
 *
 * 传输层（ws/grpc/h2/httpupgrade/xhttp/reality）统一走 ./shared.js 的子适配器，不在各协议里重复手写。
 *
 * 注意：本模块仅服务后端转换链路；前端 src/utils/protocols/converters/* 是独立 bundle，不在此处。
 */

import {
    parseQueryParams,
    extractName,
    base64Decode,
    base64Encode,
    base64UrlSafeEncode,
    parseHostPort,
    stripServerPart,
    makeWsOpts,
    makeGrpcOpts,
    makeHttpUpgradeOpts,
    makeXhttpOpts,
    makeRealityOpts,
    readWsOpts
} from './shared.js';

// ============ VLESS ============
const vlessAdapter = {
    key: 'vless',
    schemes: ['vless'],
    types: ['vless'],
    parse(url) {
        try {
            // vless://uuid@server:port?params#name
            const body = url.substring(8); // 去掉 vless://
            const atIndex = body.indexOf('@');
            if (atIndex === -1) return null;

            const uuid = body.substring(0, atIndex);
            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            const proxy = {
                name: name || `VLESS-${server}`,
                type: 'vless',
                server,
                port,
                uuid
            };

            const network = params.get('type') || 'tcp';
            if (network !== 'tcp') {
                proxy.network = network;
            }

            if (network === 'ws') {
                const wsOpts = makeWsOpts({ path: params.get('path'), host: params.get('host') });
                if (wsOpts) proxy['ws-opts'] = wsOpts;
            }

            // xHTTP 配置 (Loon 3.0+ / Xray 1.8.7+)
            if (network === 'xhttp') {
                const xhttpOpts = makeXhttpOpts({
                    path: params.get('xhttp-path') || params.get('path'),
                    host: params.get('xhttp-host') || params.get('host') || params.get('sni'),
                    mode: params.get('mode')
                });
                if (xhttpOpts) proxy['xhttp-opts'] = xhttpOpts;
            }

            if (network === 'grpc') {
                const grpcOpts = makeGrpcOpts({ serviceName: params.get('serviceName'), mode: params.get('mode') });
                if (grpcOpts) proxy['grpc-opts'] = grpcOpts;
            }

            if (network === 'httpupgrade') {
                const httpupgradeOpts = makeHttpUpgradeOpts({ path: params.get('path'), host: params.get('host') });
                if (httpupgradeOpts) proxy['httpupgrade-opts'] = httpupgradeOpts;
            }

            // 安全配置
            const security = params.get('security') || 'none';
            if (security === 'reality') {
                proxy.tls = true;
                const realityOpts = makeRealityOpts({
                    publicKey: params.get('pbk'),
                    shortId: params.get('sid'),
                    spiderX: params.get('spx')
                });
                if (realityOpts) proxy['reality-opts'] = realityOpts;
            } else if (security === 'tls') {
                proxy.tls = true;
            }

            // Skip cert verify (统一支持 allowInsecure 和 insecure)
            if (params.get('allowInsecure') === '1' || params.get('insecure') === '1') {
                proxy['skip-cert-verify'] = true;
            }

            // SNI (支持 sni 和 peer 两种参数名，Shadowrocket 使用 peer)
            if (params.get('sni')) {
                proxy.servername = params.get('sni');
                proxy.sni = params.get('sni');
            } else if (params.get('peer')) {
                proxy.servername = params.get('peer');
                proxy.sni = params.get('peer');
            }

            if (params.get('fp')) proxy['client-fingerprint'] = params.get('fp');
            if (params.get('flow')) proxy.flow = params.get('flow');
            if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',');
            if (params.get('dp')) proxy['dialer-proxy'] = params.get('dp');

            return proxy;
        } catch (e) {
            console.error('解析 VLESS URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const uuid = proxy.uuid || proxy.UUID;
        if (!uuid) return null;
        const params = ['encryption=none'];
        if (proxy.network) params.push(`type=${proxy.network}`);
        const ws = readWsOpts(proxy);
        if (ws) {
            if (ws.path) params.push(`path=${encodeURIComponent(ws.path)}`);
            if (ws.host) params.push(`host=${encodeURIComponent(ws.host)}`);
        }
        const httpupgradeOpts = proxy['httpupgrade-opts'] || proxy.httpupgradeOpts;
        if (httpupgradeOpts) {
            if (httpupgradeOpts.path) params.push(`path=${encodeURIComponent(httpupgradeOpts.path)}`);
            if (httpupgradeOpts.host) params.push(`host=${encodeURIComponent(httpupgradeOpts.host)}`);
        }
        const realityOpts = proxy['reality-opts'];
        if (realityOpts) {
            params.push('security=reality');
            if (realityOpts['public-key']) params.push(`pbk=${encodeURIComponent(realityOpts['public-key'])}`);
            if (realityOpts['short-id']) params.push(`sid=${encodeURIComponent(realityOpts['short-id'])}`);
            if (realityOpts['spider-x']) params.push(`spx=${encodeURIComponent(realityOpts['spider-x'])}`);
        } else if (proxy.tls) {
            params.push('security=tls');
        }
        if (proxy.flow) params.push(`flow=${proxy.flow}`);
        const sniVal = proxy.servername !== undefined ? proxy.servername : proxy.sni;
        if (sniVal !== undefined) params.push(`sni=${encodeURIComponent(sniVal)}`);
        if (proxy['client-fingerprint']) params.push(`fp=${encodeURIComponent(proxy['client-fingerprint'])}`);
        if (proxy['dialer-proxy']) params.push(`dp=${encodeURIComponent(proxy['dialer-proxy'])}`);
        return `vless://${uuid}@${server}:${port}?${params.join('&')}#${encodeURIComponent(name)}`;
    }
};

// ============ Trojan ============
const trojanAdapter = {
    key: 'trojan',
    schemes: ['trojan'],
    types: ['trojan'],
    parse(url) {
        try {
            // trojan://password@server:port?params#name
            const body = url.substring(9); // 去掉 trojan://
            const atIndex = body.indexOf('@');
            if (atIndex === -1) return null;

            let password = body.substring(0, atIndex);
            try {
                password = decodeURIComponent(password);
            } catch { }

            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            const proxy = {
                name: name || `Trojan-${server}`,
                type: 'trojan',
                server,
                port,
                password
            };

            const network = params.get('type') || 'tcp';
            if (network !== 'tcp') {
                proxy.network = network;
            }

            if (network === 'ws') {
                const wsOpts = makeWsOpts({ path: params.get('path'), host: params.get('host') });
                if (wsOpts) proxy['ws-opts'] = wsOpts;
            }

            if (params.get('sni')) {
                proxy.servername = params.get('sni');
                proxy.sni = params.get('sni');
            } else if (params.get('peer')) {
                proxy.servername = params.get('peer');
                proxy.sni = params.get('peer');
            }

            if (params.get('fp')) proxy['client-fingerprint'] = params.get('fp');
            if (params.get('allowInsecure') === '1') proxy['skip-cert-verify'] = true;
            if (params.get('dp')) proxy['dialer-proxy'] = params.get('dp');

            return proxy;
        } catch (e) {
            console.error('解析 Trojan URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const params = [];
        const network = proxy.network || 'tcp';
        if (network === 'ws') params.push('type=ws');
        const ws = readWsOpts(proxy);
        if (ws) {
            if (ws.path) params.push(`path=${encodeURIComponent(ws.path)}`);
            if (ws.host) params.push(`host=${encodeURIComponent(ws.host)}`);
        }
        if (proxy.sni !== undefined) params.push(`sni=${encodeURIComponent(proxy.sni)}`);
        if (proxy.skipCertVerify || proxy['skip-cert-verify']) params.push('allowInsecure=1');
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return `trojan://${encodeURIComponent(proxy.password)}@${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ VMess ============
const vmessAdapter = {
    key: 'vmess',
    schemes: ['vmess'],
    types: ['vmess'],
    parse(url) {
        try {
            // vmess://base64(json)
            const base64Part = url.substring(8);

            let normalized = base64Part.replace(/-/g, '+').replace(/_/g, '/');
            while (normalized.length % 4) normalized += '=';

            const binaryString = atob(normalized);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const jsonStr = new TextDecoder('utf-8').decode(bytes);
            const config = JSON.parse(jsonStr);

            const proxy = {
                name: config.ps || `VMess-${config.add}`,
                type: 'vmess',
                server: config.add || config.host || config.sni || '',
                port: parseInt(config.port),
                uuid: config.id,
                alterId: parseInt(config.aid) || 0,
                cipher: config.scy || 'auto'
            };

            const network = config.net || 'tcp';
            if (network !== 'tcp') {
                proxy.network = network;
            }

            if (network === 'ws') {
                const wsOpts = makeWsOpts({ path: config.path, host: config.host });
                if (wsOpts) proxy['ws-opts'] = wsOpts;
            }

            if (network === 'grpc') {
                // vmess json 有时用 path 表示 serviceName，host 优先级更高
                const grpcOpts = makeGrpcOpts({ serviceName: config.host || config.path });
                if (grpcOpts) proxy['grpc-opts'] = grpcOpts;
            }

            if (network === 'h2') {
                const h2Opts = {};
                if (config.path) h2Opts.path = config.path;
                if (config.host) h2Opts.host = config.host.split(',').map(h => h.trim());
                if (Object.keys(h2Opts).length > 0) proxy['h2-opts'] = h2Opts;
            }

            if (network === 'http') {
                proxy['http-opts'] = {
                    path: config.path || '/',
                    headers: {
                        Host: config.host ? config.host.split(',').map(h => h.trim()) : []
                    }
                };
            }

            if (network === 'quic') {
                const quicOpts = {};
                if (config.type) quicOpts.header = { type: config.type };
                if (config.host) quicOpts.security = config.host;
                if (config.path) quicOpts.key = config.path;
                if (Object.keys(quicOpts).length > 0) proxy['quic-opts'] = quicOpts;
            }

            if (config.tls === 'tls' || config.tls === 'reality') {
                proxy.tls = true;
                if (config.sni) proxy.servername = config.sni;
                if (config.fp) proxy['client-fingerprint'] = config.fp;
                if (config.alpn) proxy.alpn = String(config.alpn).split(',').map(s => s.trim());
            }

            return proxy;
        } catch (e) {
            console.error('解析 VMess URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const uuid = proxy.uuid || proxy.UUID || '';
        const network = proxy.network || 'tcp';
        const vmessConfig = {
            v: '2',
            ps: name,
            add: server,
            port,
            id: uuid,
            aid: proxy.alterId || 0,
            net: network,
            type: 'none',
            host: '',
            path: '',
            tls: proxy.tls ? 'tls' : '',
            sni: proxy.sni || proxy.servername || '',
            fp: proxy['client-fingerprint'] || ''
        };

        if (network === 'ws') {
            const ws = readWsOpts(proxy);
            if (ws) {
                vmessConfig.path = ws.path || '';
                if (ws.host) vmessConfig.host = ws.host;
            }
        } else if (network === 'grpc') {
            const grpcOpts = proxy['grpc-opts'] || proxy.grpcOpts;
            if (grpcOpts) vmessConfig.path = grpcOpts['grpc-service-name'] || '';
        } else if (network === 'h2' || network === 'http') {
            const opts = proxy[`${network}-opts`] || proxy[`${network}Opts`];
            if (opts) {
                vmessConfig.path = opts.path || '';
                vmessConfig.host = Array.isArray(opts.host) ? opts.host.join(',') : (opts.host || '');
            }
        } else if (network === 'quic') {
            const quicOpts = proxy['quic-opts'] || proxy.quicOpts;
            if (quicOpts) {
                vmessConfig.type = quicOpts.header?.type || 'none';
                vmessConfig.host = quicOpts.security || '';
                vmessConfig.path = quicOpts.key || '';
            }
        }

        return `vmess://${base64Encode(JSON.stringify(vmessConfig))}`;
    }
};

// ============ Shadowsocks ============
function normalizeSsPluginOption(key, value) {
    if (key === 'mux') {
        if (value === '1' || value === 'true') return true;
        if (value === '0' || value === 'false') return false;
    }
    return value;
}

function parseSsPlugin(pluginStr) {
    if (!pluginStr) return null;
    const parts = pluginStr.split(';');
    const name = parts[0];
    const opts = {};
    for (let i = 1; i < parts.length; i++) {
        const item = parts[i];
        if (!item) continue;
        const eqIndex = item.indexOf('=');
        if (eqIndex === -1) {
            opts[item] = true;
        } else {
            const key = item.substring(0, eqIndex);
            let val = item.substring(eqIndex + 1);
            val = val.replace(/\\=/g, '=').replace(/\\;/g, ';').replace(/\\\?/g, '?').replace(/\\:/g, ':');
            if (val === 'true') val = true;
            if (val === 'false') val = false;
            opts[key] = normalizeSsPluginOption(key, val);
        }
    }
    return { name, opts };
}

const ssAdapter = {
    key: 'ss',
    schemes: ['ss'],
    types: ['ss', 'shadowsocks'],
    parse(url) {
        try {
            // ss://base64(method:password)@server:port#name 或 ss://base64(method:password@server:port)#name
            let body = url.substring(5); // 去掉 ss://
            const name = extractName(url);
            const params = parseQueryParams(url);

            const hashIndex = body.indexOf('#');
            if (hashIndex !== -1) body = body.substring(0, hashIndex);

            const queryIndex = body.indexOf('?');
            if (queryIndex !== -1) {
                body = body.substring(0, queryIndex);
            }

            let method, password, server, port;

            const atIndex = body.lastIndexOf('@');
            if (atIndex !== -1) {
                const userInfo = body.substring(0, atIndex);
                const serverPart = body.substring(atIndex + 1);

                let decoded;
                try {
                    let normalized = userInfo.replace(/-/g, '+').replace(/_/g, '/');
                    while (normalized.length % 4) normalized += '=';
                    decoded = atob(normalized);
                } catch {
                    decoded = userInfo;
                }

                const colonIndex = decoded.indexOf(':');
                if (colonIndex !== -1) {
                    method = decoded.substring(0, colonIndex);
                    password = decoded.substring(colonIndex + 1);
                }

                const parsed = parseHostPort(serverPart);
                server = parsed.server;
                port = parsed.port;
            } else {
                let normalized = body.replace(/-/g, '+').replace(/_/g, '/');
                while (normalized.length % 4) normalized += '=';
                const decoded = atob(normalized);

                const atIdx = decoded.lastIndexOf('@');
                if (atIdx !== -1) {
                    const userPart = decoded.substring(0, atIdx);
                    const serverPart = decoded.substring(atIdx + 1);

                    const colonIndex = userPart.indexOf(':');
                    if (colonIndex !== -1) {
                        method = userPart.substring(0, colonIndex);
                        password = userPart.substring(colonIndex + 1);
                    }

                    const parsed = parseHostPort(serverPart);
                    server = parsed.server;
                    port = parsed.port;
                }
            }

            if (!method || !password || !server || !port) {
                return null;
            }

            const proxy = {
                name: name || `SS-${server}`,
                type: 'ss',
                server,
                port,
                cipher: method,
                password
            };

            const pluginStr = params.get('plugin');
            if (pluginStr) {
                const pluginDetails = parseSsPlugin(pluginStr);
                if (pluginDetails) {
                    proxy.plugin = pluginDetails.name;
                    proxy['plugin-opts'] = pluginDetails.opts;

                    const obfsMode = params.get('obfs');
                    const obfsHost = params.get('obfs-host');
                    if (obfsMode) proxy['plugin-opts'].mode = obfsMode;
                    if (obfsHost) proxy['plugin-opts'].host = obfsHost;

                    if (pluginDetails.opts.tls || pluginDetails.opts.mode?.includes('tls') || pluginDetails.opts.security === 'tls') {
                        proxy.tls = true;
                    }
                    if (pluginDetails.opts.host) {
                        proxy.sni = pluginDetails.opts.host;
                        proxy.servername = pluginDetails.opts.host;
                    }
                }
            }

            return proxy;
        } catch (e) {
            console.error('解析 SS URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const userInfo = base64Encode(`${proxy.cipher}:${proxy.password}`);
        let url = `ss://${userInfo}@${server}:${port}`;
        if (proxy.plugin) {
            const params = [];
            params.push(`plugin=${encodeURIComponent(proxy.plugin)}`);
            const pluginOpts = proxy['plugin-opts'];
            if (pluginOpts) {
                if (pluginOpts.enabled !== undefined) params.push(`enabled=${pluginOpts.enabled}`);
                if (pluginOpts.padding !== undefined) params.push(`padding=${pluginOpts.padding}`);
                if (pluginOpts.mode) params.push(`obfs=${encodeURIComponent(pluginOpts.mode)}`);
                if (pluginOpts.host) params.push(`obfs-host=${encodeURIComponent(pluginOpts.host)}`);
            }
            if (params.length > 0) url += `?${params.join('&')}`;
        }
        return `${url}#${encodeURIComponent(name)}`;
    }
};

// ============ ShadowsocksR ============
const ssrAdapter = {
    key: 'ssr',
    schemes: ['ssr'],
    types: ['ssr', 'shadowsocksr'],
    parse(url) {
        try {
            const b64 = url.substring(6);
            const decoded = base64Decode(b64);

            // server:port:protocol:method:obfs:password_base64/?params
            const mainParts = decoded.split(':');
            if (mainParts.length < 6) return null;

            const server = mainParts[0];
            const port = parseInt(mainParts[1]);
            const protocol = mainParts[2];
            const cipher = mainParts[3];
            const obfs = mainParts[4];

            const passwordPart = mainParts[5];
            const passwordEndIndex = passwordPart.indexOf('/');
            const passwordBase64 = passwordEndIndex !== -1 ? passwordPart.substring(0, passwordEndIndex) : passwordPart;
            const password = base64Decode(passwordBase64);

            const proxy = {
                name: `SSR-${server}`,
                type: 'ssr',
                server,
                port,
                protocol,
                cipher,
                obfs,
                password,
                udp: true
            };

            if (passwordEndIndex !== -1) {
                const paramsStr = passwordPart.substring(passwordEndIndex + 2); // skip /?
                const params = new URLSearchParams(paramsStr);

                if (params.get('obfsparam')) proxy['obfs-param'] = base64Decode(params.get('obfsparam'));
                if (params.get('protoparam')) proxy['protocol-param'] = base64Decode(params.get('protoparam'));
                if (params.get('remarks')) proxy.name = base64Decode(params.get('remarks'));
                if (params.get('group')) proxy.group = base64Decode(params.get('group'));
                if (params.get('udpport')) proxy.udpport = params.get('udpport');
            }

            return proxy;
        } catch (e) {
            console.error('解析 SSR URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const password = base64UrlSafeEncode(proxy.password);
        const params = `obfs=${proxy.obfs || 'plain'}&obfsparam=${base64UrlSafeEncode(proxy['obfs-param'] || '')}&protocol=${proxy.protocol || 'origin'}&protoparam=${base64UrlSafeEncode(proxy['protocol-param'] || '')}&remarks=${base64UrlSafeEncode(name)}`;
        const ssrBody = `${server}:${port}:${proxy.protocol || 'origin'}:${proxy.cipher || 'none'}:${proxy.obfs || 'plain'}:${password}/?${params}`;
        return `ssr://${base64UrlSafeEncode(ssrBody)}`;
    }
};

// ============ SSD (parse only) ============
const ssdAdapter = {
    key: 'ssd',
    schemes: ['ssd'],
    types: [],
    parse(url) {
        try {
            const b64 = url.substring(6);
            const decoded = base64Decode(b64);
            const config = JSON.parse(decoded);

            // SSD 通常包含一个数组，这里取第一个有效项（builtin 流程目前是 1-to-1 映射）
            if (!config.servers || !config.servers.length) return null;

            const s = config.servers[0];
            return {
                name: s.remarks || `SSD-${s.server}`,
                type: 'ss',
                server: s.server,
                port: s.port,
                cipher: config.encryption || s.encryption || 'aes-256-gcm',
                password: config.password || s.password,
                plugin: s.plugin,
                'plugin-opts': s.plugin_options ? { host: s.plugin_options } : undefined
            };
        } catch (e) {
            console.error('解析 SSD URL 失败:', e);
            return null;
        }
    }
};

// ============ Hysteria2 ============
function appendHysteria2RealmParams(params, realmOpts) {
    if (!realmOpts || typeof realmOpts !== 'object') return;
    if (realmOpts['realm-id']) params.push(`realm-id=${encodeURIComponent(realmOpts['realm-id'])}`);
    if (realmOpts.token) params.push(`realm-token=${encodeURIComponent(realmOpts.token)}`);
    if (realmOpts['server-url']) params.push(`realm-server=${encodeURIComponent(realmOpts['server-url'])}`);
    if (Array.isArray(realmOpts['stun-servers']) && realmOpts['stun-servers'].length > 0) {
        params.push(`stun-servers=${encodeURIComponent(realmOpts['stun-servers'].join(','))}`);
    }
}

const hysteria2Adapter = {
    key: 'hysteria2',
    schemes: ['hysteria2', 'hy2'],
    types: ['hysteria2', 'hy2', 'hy'],
    parse(url) {
        try {
            // hysteria2://password@server:port?params#name 或 hy2://...
            const prefixLen = url.startsWith('hysteria2://') ? 12 : 6;
            const body = url.substring(prefixLen);

            const atIndex = body.indexOf('@');
            if (atIndex === -1) return null;

            let password = body.substring(0, atIndex);
            try {
                password = decodeURIComponent(password);
            } catch { }

            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            const proxy = {
                name: name || `Hysteria2-${server}`,
                type: 'hysteria2',
                server,
                port,
                password
            };

            if (params.get('sni')) {
                proxy.servername = params.get('sni');
                proxy.sni = params.get('sni');
            }

            if (params.get('insecure') === '1' || params.get('allowInsecure') === '1') {
                proxy['skip-cert-verify'] = true;
            }

            if (params.get('obfs')) {
                proxy.obfs = params.get('obfs');
                if (params.get('obfs-password')) {
                    proxy['obfs-password'] = params.get('obfs-password');
                }
            }

            const realmId = params.get('realm-id');
            const realmToken = params.get('realm-token') || params.get('token');
            const realmServerUrl = params.get('realm-server') || params.get('server-url');
            const stunServers = params.get('stun-servers');
            if (realmId || realmToken || realmServerUrl || stunServers) {
                proxy['realm-opts'] = { enable: true };
                if (realmId) proxy['realm-opts']['realm-id'] = realmId;
                if (realmToken) proxy['realm-opts'].token = realmToken;
                if (realmServerUrl) proxy['realm-opts']['server-url'] = realmServerUrl;
                if (stunServers) {
                    proxy['realm-opts']['stun-servers'] = stunServers.split(',').map(item => item.trim()).filter(Boolean);
                }
            }

            if (params.get('dp')) proxy['dialer-proxy'] = params.get('dp');

            return proxy;
        } catch (e) {
            console.error('解析 Hysteria2 URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const params = [];
        const password = proxy.password || proxy.auth || '';
        if (proxy.obfs) params.push(`obfs=${encodeURIComponent(proxy.obfs)}`);
        if (proxy['obfs-password']) params.push(`obfs-password=${encodeURIComponent(proxy['obfs-password'])}`);
        if (proxy.sni !== undefined) params.push(`sni=${encodeURIComponent(proxy.sni)}`);
        if (proxy.skipCertVerify || proxy['skip-cert-verify']) params.push('insecure=1');
        appendHysteria2RealmParams(params, proxy['realm-opts']);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return `hysteria2://${encodeURIComponent(password)}@${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ Hysteria (build only) ============
const hysteriaAdapter = {
    key: 'hysteria',
    schemes: [],
    types: ['hysteria'],
    build(proxy, { name, server, port }) {
        const params = [];
        const password = proxy.password || proxy.auth || '';
        if (proxy.protocol === 'udp') params.push('protocol=udp');
        if (proxy.sni !== undefined) params.push(`sni=${encodeURIComponent(proxy.sni)}`);
        if (proxy.skipCertVerify || proxy['skip-cert-verify']) params.push('insecure=1');
        if (proxy.up || proxy['up-mbps']) params.push(`up=${proxy.up || proxy['up-mbps']}`);
        if (proxy.down || proxy['down-mbps']) params.push(`down=${proxy.down || proxy['down-mbps']}`);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return `hysteria://${encodeURIComponent(password)}@${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ TUIC ============
const tuicAdapter = {
    key: 'tuic',
    schemes: ['tuic'],
    types: ['tuic'],
    parse(url) {
        try {
            // tuic://token@server:port?sni=xxx&alpn=xxx#name
            const body = url.substring(7); // 去掉 tuic://

            const atIndex = body.lastIndexOf('@');
            if (atIndex === -1) return null;

            const token = body.substring(0, atIndex);
            const separatorIndex = token.indexOf(':');
            const rawUuid = separatorIndex === -1 ? token : token.substring(0, separatorIndex);
            const rawPassword = separatorIndex === -1 ? '' : token.substring(separatorIndex + 1);

            const safeDecode = (value) => {
                try {
                    return decodeURIComponent(value);
                } catch {
                    return value;
                }
            };

            const uuid = safeDecode(rawUuid);
            const password = safeDecode(rawPassword);

            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            const proxy = {
                name: name || `TUIC-${server}`,
                type: 'tuic',
                server,
                port,
                uuid,
                password
            };

            const sni = params.get('sni');
            if (sni) {
                proxy.servername = sni;
                proxy.sni = sni;
            }

            if (params.get('alpn')) {
                proxy.alpn = params.get('alpn').split(',');
            }

            if (params.get('allowInsecure') === '1' || params.get('insecure') === '1' || params.get('allow_insecure') === '1') {
                proxy['skip-cert-verify'] = true;
            }

            const congestionControl = params.get('congestion_control') || params.get('congestion-control') || params.get('congestion-controller');
            if (congestionControl) {
                proxy['congestion-controller'] = congestionControl;
            }

            const udpRelayMode = params.get('udp_relay_mode') || params.get('udp-relay-mode');
            if (udpRelayMode) {
                proxy['udp-relay-mode'] = udpRelayMode;
            }

            const udpOverStream = params.get('udp_over_stream') || params.get('udp-over-stream');
            if (udpOverStream === '1' || udpOverStream === 'true') {
                proxy['udp-over-stream'] = true;
            } else if (udpOverStream === '0' || udpOverStream === 'false') {
                proxy['udp-over-stream'] = false;
            }

            const zeroRttHandshake = params.get('zero_rtt_handshake') || params.get('zero-rtt-handshake') || params.get('reduce_rtt') || params.get('reduce-rtt');
            if (zeroRttHandshake === '1' || zeroRttHandshake === 'true') {
                proxy['zero-rtt-handshake'] = true;
                proxy['reduce-rtt'] = true;
            } else if (zeroRttHandshake === '0' || zeroRttHandshake === 'false') {
                proxy['zero-rtt-handshake'] = false;
                proxy['reduce-rtt'] = false;
            }

            if (params.get('heartbeat')) {
                proxy.heartbeat = params.get('heartbeat');
            }
            if (params.get('heartbeat_interval') || params.get('heartbeat-interval')) {
                proxy['heartbeat-interval'] = params.get('heartbeat_interval') || params.get('heartbeat-interval');
            }
            if (params.get('request_timeout') || params.get('request-timeout')) {
                proxy['request-timeout'] = Number(params.get('request_timeout') || params.get('request-timeout'));
            }
            if (params.get('cwnd')) {
                proxy.cwnd = Number(params.get('cwnd'));
            }
            if (params.get('bbr_profile') || params.get('bbr-profile')) {
                proxy['bbr-profile'] = params.get('bbr_profile') || params.get('bbr-profile');
            }
            if (params.get('max_udp_relay_packet_size') || params.get('max-udp-relay-packet-size')) {
                proxy['max-udp-relay-packet-size'] = Number(params.get('max_udp_relay_packet_size') || params.get('max-udp-relay-packet-size'));
            }
            if (params.get('max_open_streams') || params.get('max-open-streams')) {
                proxy['max-open-streams'] = Number(params.get('max_open_streams') || params.get('max-open-streams'));
            }

            const disableSni = params.get('disable_sni') || params.get('disable-sni');
            if (disableSni === '1' || disableSni === 'true') {
                proxy['disable-sni'] = true;
            } else if (disableSni === '0' || disableSni === 'false') {
                proxy['disable-sni'] = false;
            }

            const fastOpen = params.get('fast_open') || params.get('fast-open');
            if (fastOpen === '1' || fastOpen === 'true') {
                proxy['fast-open'] = true;
            } else if (fastOpen === '0' || fastOpen === 'false') {
                proxy['fast-open'] = false;
            }

            if (params.get('dp')) proxy['dialer-proxy'] = params.get('dp');

            proxy.udp = true;

            return proxy;
        } catch (e) {
            console.error('解析 TUIC URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const uuid = proxy.uuid || '';
        const password = proxy.password || proxy.token || '';
        const auth = password
            ? `${encodeURIComponent(uuid)}:${encodeURIComponent(password)}`
            : encodeURIComponent(uuid);
        const params = [];
        if (proxy.sni !== undefined) params.push(`sni=${encodeURIComponent(proxy.sni)}`);
        if (proxy.alpn) {
            const alpn = Array.isArray(proxy.alpn) ? proxy.alpn.join(',') : proxy.alpn;
            params.push(`alpn=${encodeURIComponent(alpn)}`);
        }
        if (proxy['skip-cert-verify']) params.push('allow_insecure=1');
        const congestionControl = proxy['congestion-controller'] || proxy['congestion-control'] || proxy.congestion;
        if (congestionControl) params.push(`congestion_control=${encodeURIComponent(congestionControl)}`);
        if (proxy['udp-relay-mode']) params.push(`udp_relay_mode=${encodeURIComponent(proxy['udp-relay-mode'])}`);
        if (proxy['udp-over-stream'] !== undefined) params.push(`udp_over_stream=${proxy['udp-over-stream'] ? '1' : '0'}`);
        if (proxy['zero-rtt-handshake'] !== undefined) params.push(`zero_rtt_handshake=${proxy['zero-rtt-handshake'] ? '1' : '0'}`);
        else if (proxy['reduce-rtt'] !== undefined) params.push(`zero_rtt_handshake=${proxy['reduce-rtt'] ? '1' : '0'}`);
        if (proxy.heartbeat) params.push(`heartbeat=${encodeURIComponent(proxy.heartbeat)}`);
        if (proxy['heartbeat-interval']) params.push(`heartbeat_interval=${encodeURIComponent(proxy['heartbeat-interval'])}`);
        if (proxy['request-timeout']) params.push(`request_timeout=${encodeURIComponent(String(proxy['request-timeout']))}`);
        if (proxy.cwnd) params.push(`cwnd=${encodeURIComponent(String(proxy.cwnd))}`);
        if (proxy['bbr-profile']) params.push(`bbr_profile=${encodeURIComponent(proxy['bbr-profile'])}`);
        if (proxy['max-udp-relay-packet-size']) params.push(`max_udp_relay_packet_size=${encodeURIComponent(String(proxy['max-udp-relay-packet-size']))}`);
        if (proxy['max-open-streams']) params.push(`max_open_streams=${encodeURIComponent(String(proxy['max-open-streams']))}`);
        if (proxy['disable-sni'] !== undefined) params.push(`disable_sni=${proxy['disable-sni'] ? '1' : '0'}`);
        if (proxy['fast-open'] !== undefined) params.push(`fast_open=${proxy['fast-open'] ? '1' : '0'}`);
        if (proxy['dialer-proxy']) params.push(`dp=${encodeURIComponent(proxy['dialer-proxy'])}`);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return `tuic://${auth}@${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ Snell ============
const snellAdapter = {
    key: 'snell',
    schemes: ['snell'],
    types: ['snell'],
    parse(url) {
        try {
            const body = url.substring('snell://'.length);
            let psk = '';
            let serverPart = '';
            const atIndex = body.indexOf('@');
            if (atIndex !== -1) {
                psk = body.substring(0, atIndex);
                try { psk = decodeURIComponent(psk); } catch { }
                serverPart = body.substring(atIndex + 1);
            } else {
                serverPart = body;
            }

            const { server, port } = parseHostPort(stripServerPart(serverPart));
            const params = parseQueryParams(url);
            const name = extractName(url);

            if (!psk) psk = params.get('psk') || params.get('password') || '';

            const proxy = { name: name || `Snell-${server}`, type: 'snell', server, port, psk };
            const version = params.get('version');
            if (version) proxy.version = parseInt(version);
            const reuse = params.get('reuse');
            if (reuse !== null) proxy.reuse = reuse === 'true';
            const tfo = params.get('tfo');
            if (tfo !== null) proxy.tfo = tfo === 'true';
            const obfs = params.get('obfs');
            const obfsHost = params.get('obfs-host');
            if (obfs || obfsHost) {
                proxy['obfs-opts'] = {};
                if (obfs) proxy['obfs-opts'].mode = obfs;
                if (obfsHost) proxy['obfs-opts'].host = obfsHost;
            }
            if (params.get('udp-relay') === 'true') proxy.udp = true;
            if (params.get('ecn') === 'true' || params.get('ecn') === '1') proxy.ecn = true;
            return proxy;
        } catch (e) {
            console.error('解析 Snell URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const params = [];
        if (proxy.version) params.push(`version=${proxy.version}`);
        if (proxy.reuse !== undefined) params.push(`reuse=${proxy.reuse}`);
        if (proxy.tfo !== undefined) params.push(`tfo=${proxy.tfo}`);
        const obfsOpts = proxy['obfs-opts'] || proxy.pluginOpts;
        if (obfsOpts) {
            if (obfsOpts.mode) params.push(`obfs=${obfsOpts.mode}`);
            if (obfsOpts.host) params.push(`obfs-host=${encodeURIComponent(obfsOpts.host)}`);
        }
        if (proxy.ecn) params.push('ecn=true');
        const psk = proxy.psk || proxy.password || '';
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return `snell://${encodeURIComponent(psk)}@${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ AnyTLS ============
const anytlsAdapter = {
    key: 'anytls',
    schemes: ['anytls'],
    types: ['anytls'],
    parse(url) {
        try {
            const body = url.substring(9);
            let password = '';
            let serverPart = '';
            const atIndex = body.indexOf('@');
            if (atIndex !== -1) {
                password = body.substring(0, atIndex);
                try { password = decodeURIComponent(password); } catch { }
                serverPart = body.substring(atIndex + 1);
            } else {
                serverPart = body;
            }

            const { server, port } = parseHostPort(stripServerPart(serverPart));
            const safePort = isNaN(port) ? 443 : port;
            const params = parseQueryParams(url);
            const name = extractName(url);

            const proxy = {
                name: name || `AnyTLS-${server}`,
                type: 'anytls',
                server,
                port: safePort,
                password
            };

            const sni = params.get('sni') || params.get('peer');
            if (sni) {
                proxy.servername = sni;
                proxy.sni = sni;
            }

            if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',');
            if (params.get('insecure') === '1' || params.get('allowInsecure') === '1') proxy['skip-cert-verify'] = true;

            proxy.udp = true;
            return proxy;
        } catch (e) {
            console.error('解析 AnyTLS URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name, server, port }) {
        const password = proxy.password || '';
        const params = [];
        if (proxy.sni !== undefined) params.push(`sni=${encodeURIComponent(proxy.sni)}`);
        if (proxy.alpn) {
            const alpn = Array.isArray(proxy.alpn) ? proxy.alpn.join(',') : proxy.alpn;
            params.push(`alpn=${encodeURIComponent(alpn)}`);
        }
        if (proxy['skip-cert-verify']) params.push('insecure=1');
        if (proxy.padding !== undefined) params.push(`padding=${proxy.padding}`);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return `anytls://${encodeURIComponent(password)}@${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ WireGuard ============
const wireguardAdapter = {
    key: 'wireguard',
    schemes: ['wireguard'],
    types: ['wireguard'],
    parse(url) {
        try {
            // wireguard://privatekey@server:port?params#name
            const body = url.substring('wireguard://'.length);

            const atIndex = body.indexOf('@');
            if (atIndex === -1) return null;

            let privateKey = body.substring(0, atIndex);
            try {
                privateKey = decodeURIComponent(privateKey);
            } catch { }

            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            const proxy = {
                name: name || `WireGuard-${server}`,
                type: 'wireguard',
                server,
                port,
                'private-key': privateKey,
                'remote-dns-resolve': true,
                udp: true
            };

            const publicKey = params.get('publickey') || params.get('public-key');
            if (publicKey) proxy['public-key'] = publicKey;

            const address = params.get('address');
            if (address) proxy.ip = address.split(',').map(a => a.trim());

            const allowedIPs = params.get('allowedips') || params.get('allowed-ips');
            if (allowedIPs) proxy['allowed-ips'] = allowedIPs.split(',').map(a => a.trim());

            const reserved = params.get('reserved');
            if (reserved) {
                const reservedArr = reserved.split(',').map(n => parseInt(n.trim()));
                if (reservedArr.every(n => !isNaN(n))) proxy.reserved = reservedArr;
            }

            const mtu = params.get('mtu');
            if (mtu) proxy.mtu = parseInt(mtu);

            const dns = params.get('dns');
            if (dns) proxy.dns = dns.split(',').map(d => d.trim());

            const keepalive = params.get('keepalive');
            if (keepalive) proxy['persistent-keepalive'] = parseInt(keepalive);

            const presharedKey = params.get('presharedkey') || params.get('preshared-key');
            if (presharedKey) proxy['preshared-key'] = presharedKey;

            return proxy;
        } catch (e) {
            console.error('解析 WireGuard URL 失败:', e);
            return null;
        }
    },
    build(proxy, { name }) {
        if (!proxy['private-key'] || !proxy.server || !proxy.port) return null;
        const params = new URLSearchParams();
        if (proxy['public-key'] || proxy.publicKey) params.set('publickey', proxy['public-key'] || proxy.publicKey);
        if (proxy.ip || proxy['local-address']) {
            const addr = Array.isArray(proxy.ip || proxy['local-address']) ? (proxy.ip || proxy['local-address']).join(',') : (proxy.ip || proxy['local-address']);
            params.set('address', addr);
        }
        if (proxy['allowed-ips'] || proxy.allowedIPs) {
            const ips = Array.isArray(proxy['allowed-ips'] || proxy.allowedIPs) ? (proxy['allowed-ips'] || proxy.allowedIPs).join(',') : (proxy['allowed-ips'] || proxy.allowedIPs);
            params.set('allowedips', ips);
        }
        if (proxy.reserved) params.set('reserved', Array.isArray(proxy.reserved) ? proxy.reserved.join(',') : String(proxy.reserved));
        if (proxy.mtu) params.set('mtu', String(proxy.mtu));
        if (proxy.dns) params.set('dns', Array.isArray(proxy.dns) ? proxy.dns.join(',') : proxy.dns);
        if (proxy['persistent-keepalive']) params.set('keepalive', String(proxy['persistent-keepalive']));
        if (proxy['preshared-key'] || proxy.presharedKey) params.set('presharedkey', proxy['preshared-key'] || proxy.presharedKey);
        let serverAddr = proxy.server;
        if (serverAddr.includes(':') && !serverAddr.startsWith('[')) serverAddr = `[${serverAddr}]`;
        return `wireguard://${encodeURIComponent(proxy['private-key'])}@${serverAddr}:${proxy.port}?${params.toString()}#${encodeURIComponent(name)}`;
    }
};

// ============ HTTPS (parse only) ============
const httpsAdapter = {
    key: 'https',
    schemes: ['https'],
    types: [],
    parse(url) {
        try {
            // https://username:password@server:port?params#name
            const body = url.substring(8);
            const atIndex = body.indexOf('@');
            if (atIndex === -1) return null;

            const userInfo = body.substring(0, atIndex);
            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            let username = '';
            let password = '';
            const colonIndex = userInfo.indexOf(':');
            if (colonIndex !== -1) {
                username = decodeURIComponent(userInfo.substring(0, colonIndex));
                password = decodeURIComponent(userInfo.substring(colonIndex + 1));
            } else {
                username = decodeURIComponent(userInfo);
            }

            const proxy = {
                name: name || `HTTPS-${server}`,
                type: 'https',
                server,
                port,
                username,
                password
            };

            if (params.get('sni')) {
                proxy.servername = params.get('sni');
                proxy.sni = params.get('sni');
            } else if (params.get('peer')) {
                proxy.servername = params.get('peer');
                proxy.sni = params.get('peer');
            }

            if (params.get('allowInsecure') === '1' || params.get('insecure') === '1') {
                proxy['skip-cert-verify'] = true;
            }

            proxy.udp = false;
            return proxy;
        } catch (e) {
            console.error('解析 HTTPS URL 失败:', e);
            return null;
        }
    }
};

// ============ SOCKS5 (parse) ============
const socks5Adapter = {
    key: 'socks5',
    schemes: ['socks5'],
    types: ['socks5'],
    parse(url) {
        try {
            // socks5://username:password@server:port?tls=1#name
            const body = url.substring(9);
            const atIndex = body.indexOf('@');
            if (atIndex === -1) return null;

            const userInfo = body.substring(0, atIndex);
            const { server, port } = parseHostPort(stripServerPart(body.substring(atIndex + 1)));
            const params = parseQueryParams(url);
            const name = extractName(url);

            let username = '';
            let password = '';
            const colonIndex = userInfo.indexOf(':');
            if (colonIndex !== -1) {
                username = decodeURIComponent(userInfo.substring(0, colonIndex));
                password = decodeURIComponent(userInfo.substring(colonIndex + 1));
            } else {
                username = decodeURIComponent(userInfo);
            }

            const useTls = params.get('tls') === '1' || params.get('tls') === 'true' || params.get('secure') === '1';
            const proxy = {
                name: name || `SOCKS5-${server}`,
                type: useTls ? 'socks5-tls' : 'socks5',
                server,
                port,
                username,
                password,
                udp: false
            };

            if (params.get('sni')) {
                proxy.servername = params.get('sni');
                proxy.sni = params.get('sni');
            } else if (params.get('peer')) {
                proxy.servername = params.get('peer');
                proxy.sni = params.get('peer');
            }

            if (params.get('allowInsecure') === '1' || params.get('insecure') === '1') {
                proxy['skip-cert-verify'] = true;
            }

            return proxy;
        } catch (e) {
            console.error('解析 SOCKS5 URL 失败:', e);
            return null;
        }
    },
    // record→url：clash type 'socks5'
    build(proxy, { name, server, port }) {
        const auth = proxy.username && proxy.password ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : '';
        return `socks5://${auth}${server}:${port}#${encodeURIComponent(name)}`;
    }
};

// ============ HTTP (build only) ============
const httpAdapter = {
    key: 'http',
    schemes: [],
    types: ['http'],
    build(proxy, { name, server, port }) {
        const auth = proxy.username && proxy.password ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : '';
        return `http://${auth}${server}:${port}#${encodeURIComponent(name)}`;
    }
};

// ============ Naive (build only; type 'naive' 或 proxy.protocol === 'naive') ============
const naiveAdapter = {
    key: 'naive',
    schemes: [],
    types: ['naive'],
    matches(type, proxy) {
        return type === 'naive' || proxy.protocol === 'naive';
    },
    build(proxy, { name, server, port }) {
        const username = proxy.username || '';
        const password = proxy.password || '';
        const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
        const params = [];
        if (proxy.padding !== undefined) params.push(`padding=${proxy.padding}`);
        if (proxy['extra-headers']) params.push(`extra-headers=${encodeURIComponent(proxy['extra-headers'])}`);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        const scheme = proxy.quic ? 'naive+quic' : 'naive+https';
        return `${scheme}://${auth}${server}:${port}${query}#${encodeURIComponent(name)}`;
    }
};

// ============ 注册表 ============

export const PROTOCOL_ADAPTERS = [
    vlessAdapter,
    trojanAdapter,
    vmessAdapter,
    ssAdapter,
    ssrAdapter,
    ssdAdapter,
    hysteria2Adapter,
    hysteriaAdapter,
    tuicAdapter,
    snellAdapter,
    anytlsAdapter,
    wireguardAdapter,
    httpsAdapter,
    socks5Adapter,
    httpAdapter,
    naiveAdapter
];

const SCHEME_MAP = new Map();
const TYPE_MAP = new Map();
for (const adapter of PROTOCOL_ADAPTERS) {
    for (const scheme of adapter.schemes || []) {
        if (typeof adapter.parse === 'function') SCHEME_MAP.set(scheme, adapter);
    }
    for (const type of adapter.types || []) {
        if (typeof adapter.build === 'function') TYPE_MAP.set(type, adapter);
    }
}

/** 按 URL scheme 取解析适配器 */
export function findAdapterByUrl(url) {
    const sep = url.indexOf('://');
    if (sep === -1) return null;
    return SCHEME_MAP.get(url.substring(0, sep).toLowerCase()) || null;
}

/** 按 clash type 取生成适配器（含 naive 的特殊匹配） */
export function findAdapterByType(type, proxy) {
    const direct = TYPE_MAP.get(type);
    if (direct) return direct;
    for (const adapter of PROTOCOL_ADAPTERS) {
        if (typeof adapter.matches === 'function' && typeof adapter.build === 'function' && adapter.matches(type, proxy)) {
            return adapter;
        }
    }
    return null;
}

/** url → record（Clash proxy 对象），不支持的协议返回 null */
export function urlToProxy(url) {
    if (!url || typeof url !== 'string') return null;
    const adapter = findAdapterByUrl(url);
    if (!adapter || typeof adapter.parse !== 'function') return null;
    return adapter.parse(url);
}

/** record（Clash proxy 对象）→ url，不支持的协议返回 null */
export function proxyToUrl(proxy) {
    try {
        const type = (proxy.type || '').toLowerCase();
        const name = proxy.name || 'Untitled';
        const server = proxy.server;
        const port = proxy.port;

        if (!server || !port) return null;

        const adapter = findAdapterByType(type, proxy);
        if (!adapter || typeof adapter.build !== 'function') return null;

        return adapter.build(proxy, { type, name, server, port });
    } catch (e) {
        console.error('Error converting proxy:', e);
        return null;
    }
}
