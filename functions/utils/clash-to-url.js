/**
 * Clash 代理对象 → 节点 URL（后端）
 *
 * 分发统一走 ./protocol-adapters 注册表（按 proxy.type 查表），不再用并行 switch/if 链。
 * 各协议的字段生成由对应适配器（functions/utils/protocol-adapters/index.js）负责。
 */

import { proxyToUrl } from './protocol-adapters/index.js';

export function convertClashProxyToUrl(proxy) {
    return proxyToUrl(proxy);
}
