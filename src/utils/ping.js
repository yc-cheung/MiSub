/**
 * 纯前端的「可达性探测」工具（非测速）。
 * 利用浏览器的 Fetch API 发送无 CORS 请求触发到目标 host:port 的一次网络往返。
 *
 * 局限：浏览器对 no-cors 请求的失败只返回 opaque 错误，无法区分
 * “TCP 被拒 / TLS 失败 / HTTP 被拒”。唯一可用信号是耗时——
 * 一次真正的网络往返（哪怕最终 reject）耗时 >= 阈值，说明 host:port 可达；
 * 极短时间内（< 阈值）失败通常是 DNS 解析失败 / 本地断网 / 被拦截，判为不可达。
 * 所以这是“是否可达”的启发式探测，测到的也是 TCP/TLS 握手 RTT，不是代理延迟。
 */

// 低于此耗时的 reject 视为“还没发生网络往返”，判为不可达。
const REACHABLE_MIN_LATENCY_MS = 10;

/**
 * 探测单个节点的可达性
 * @param {string} host 节点服务器 IP 或域名
 * @param {number|string} port 节点端口
 * @param {number} timeoutMs 超时时间（毫秒）
 * @returns {Promise<{status: 'ok'|'timeout'|'error', latency: number, message?: string}>}
 */
export async function pingNode(host, port, timeoutMs = 3000) {
    if (!host || !port) {
        return { status: 'error', latency: -1, message: '无效的地址或端口' };
    }

    return new Promise((resolve) => {
        const start = performance.now();
        const controller = new AbortController();
        
        const timeoutId = setTimeout(() => {
            controller.abort();
            resolve({ status: 'timeout', latency: timeoutMs });
        }, timeoutMs);

        // 如果我们在 HTTPS 环境下，浏览器强迫阻止发送 http:// 请求（Mixed Content Blocked），
        // 且此拦截不触发正常网络请求耗时。所以必须统一使用 https:// 探测。
        // 即便对方是不是 TLS, 也会强制握手(耗时1-2个 RTT)。
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        
        // 规避浏览器缓存
        const cacheBuster = Date.now() + Math.random().toString(36).substring(7);
        const testUrl = `${protocol}//${host}:${port}/__ping_${cacheBuster}`;

        fetch(testUrl, {
            mode: 'no-cors',
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal
        }).then(() => {
            // 如果节点碰巧是一个 HTTP(S) 服务器并且响应了，请求会成功 (opaque)
            clearTimeout(timeoutId);
            const latency = Math.round(performance.now() - start);
            resolve({ status: 'ok', latency });
        }).catch((err) => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                resolve({ status: 'timeout', latency: timeoutMs });
                return;
            }
            const latency = Math.round(performance.now() - start);
            if (latency < REACHABLE_MIN_LATENCY_MS) {
                // 几乎瞬间失败：多半是 DNS 解析失败 / 本地断网 / 被拦截，未发生网络往返 → 不可达
                resolve({ status: 'error', latency: -1, message: '不可达' });
            } else {
                // 经历了一次网络往返（TLS 握手失败 / 被主动断开 / 端口拒绝），耗时即 TCP(+TLS) 的 RTT → 可达
                resolve({ status: 'ok', latency });
            }
        });
    });
}
