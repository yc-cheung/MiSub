/**
 * Telegram Bot 的纯消息构建函数（输入 -> HTML 字符串），无副作用、可快照测试。
 * 命令/回调模块调用这些函数生成消息文本，而不再内联拼接。
 */

/** /start 欢迎消息 */
export function formatStartMessage() {
    return '👋 <b>欢迎使用 MiSub Telegram Bot！</b>\n\n' +
        '通过这个 Bot，你可以：\n' +
        '• 📤 快速添加代理节点\n' +
        '• 📋 管理你的节点列表\n' +
        '• 🔗 获取订阅链接\n\n' +
        '直接发送节点链接即可添加，支持批量添加。\n\n' +
        '发送 /help 查看完整命令列表\n' +
        '发送 /menu 打开快捷菜单';
}

/** /help 命令帮助 */
export function formatHelpMessage() {
    return '📖 <b>MiSub Bot 命令帮助</b>\n\n' +
        '<b>📤 添加节点</b>\n' +
        '直接发送节点链接（支持批量）\n\n' +
        '<b>📋 查看</b>\n' +
        '/list - 节点列表\n' +
        '/stats - 统计信息\n' +
        '/info [序号] - 节点详情\n' +
        '/search [词] - 搜索节点\n\n' +
        '<b>✏️ 编辑</b>\n' +
        '/enable [序号] - 启用\n' +
        '/disable [序号] - 禁用\n' +
        '/rename [序号] [名] - 重命名\n' +
        '/delete [序号] - 删除\n\n' +
        '<b>🔧 工具</b>\n' +
        '/bind - 绑定订阅组\n' +
        '/sort [类型] - 排序\n' +
        '/dup - 去重\n' +
        '/copy [序号] - 复制链接\n' +
        '/menu - 快捷菜单\n\n' +
        '💡 序号支持：1 | 1,3,5 | all';
}
