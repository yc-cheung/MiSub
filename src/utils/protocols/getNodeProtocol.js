/**
 * 从节点 URL 推断协议标识（小写 key）。
 * 节点卡片 / 节点列表共用，避免各处的 getProtocol 逻辑漂移。
 *
 * @param {string} url 节点 URL
 * @returns {string} 协议标识，如 'ss' / 'vmess' / 'snell'；无法识别返回 'unknown'
 */
export function getNodeProtocol(url) {
  try {
    if (!url) return 'unknown';
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('anytls://')) return 'anytls';
    if (lowerUrl.startsWith('hysteria2://') || lowerUrl.startsWith('hy2://')) return 'hysteria2';
    if (lowerUrl.startsWith('hysteria://') || lowerUrl.startsWith('hy://')) return 'hysteria';
    if (lowerUrl.startsWith('ssr://')) return 'ssr';
    if (lowerUrl.startsWith('tuic://')) return 'tuic';
    if (lowerUrl.startsWith('ss://')) return 'ss';
    if (lowerUrl.startsWith('vmess://')) return 'vmess';
    if (lowerUrl.startsWith('vless://')) return 'vless';
    if (lowerUrl.startsWith('trojan://')) return 'trojan';
    if (lowerUrl.startsWith('socks5://') || lowerUrl.startsWith('socks://')) return 'socks5';
    if (lowerUrl.startsWith('snell://')) return 'snell';
    if (lowerUrl.startsWith('naive+https://') || lowerUrl.startsWith('naive+http://') || lowerUrl.startsWith('naive+quic://')) return 'naive';
    if (lowerUrl.startsWith('http')) return 'http';
  } catch {
    return 'unknown';
  }
  return 'unknown';
}
