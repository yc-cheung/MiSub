import { NODE_PROTOCOL_REGEX } from '@/constants/nodeProtocols.js';
import { parseSurgeConfig } from './surge-parser.js';

/**
 * 把一行用户输入规范化成标准节点 URL。
 *
 * - 已是 `xxx://`（含 http/https 订阅链接）：原样返回（去首尾空白）
 * - Surge/Loon 风格的客户端配置行（如 `名字 = snell, host, port, psk=...`）：
 *   复用 parseSurgeConfig 转换为标准节点 URL（snell:// 等）
 * - 无法识别：返回 null
 *
 * @param {string} line 用户粘贴的单行内容
 * @returns {string|null} 标准节点 URL，或 null（无法识别）
 */
export function normalizeNodeInput(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 已经是标准 URL（节点或 http(s) 订阅）→ 原样返回
  if (NODE_PROTOCOL_REGEX.test(trimmed)) return trimmed;

  // 尝试按 Surge 客户端配置行解析（覆盖 snell 及其他协议）
  const nodes = parseSurgeConfig(trimmed);
  if (nodes.length === 1 && nodes[0]?.url) return nodes[0].url;

  return null;
}
