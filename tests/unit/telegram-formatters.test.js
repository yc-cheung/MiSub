import { describe, it, expect } from 'vitest';
import { formatStartMessage, formatHelpMessage } from '../../functions/modules/handlers/telegram/formatters.js';

// Snapshot tests for the pure Telegram message formatters (issue #10).
// Pin the exact HTML output so the extraction stays byte-identical.

describe('telegram formatters', () => {
    it('formatStartMessage is stable', () => {
        expect(formatStartMessage()).toMatchInlineSnapshot(`
          "👋 <b>欢迎使用 MiSub Telegram Bot！</b>

          通过这个 Bot，你可以：
          • 📤 快速添加代理节点
          • 📋 管理你的节点列表
          • 🔗 获取订阅链接

          直接发送节点链接即可添加，支持批量添加。

          发送 /help 查看完整命令列表
          发送 /menu 打开快捷菜单"
        `);
    });

    it('formatHelpMessage is stable', () => {
        expect(formatHelpMessage()).toMatchInlineSnapshot(`
          "📖 <b>MiSub Bot 命令帮助</b>

          <b>📤 添加节点</b>
          直接发送节点链接（支持批量）

          <b>📋 查看</b>
          /list - 节点列表
          /stats - 统计信息
          /info [序号] - 节点详情
          /search [词] - 搜索节点

          <b>✏️ 编辑</b>
          /enable [序号] - 启用
          /disable [序号] - 禁用
          /rename [序号] [名] - 重命名
          /delete [序号] - 删除

          <b>🔧 工具</b>
          /bind - 绑定订阅组
          /sort [类型] - 排序
          /dup - 去重
          /copy [序号] - 复制链接
          /menu - 快捷菜单

          💡 序号支持：1 | 1,3,5 | all"
        `);
    });
});
