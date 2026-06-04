/**
 * 旧版 nodeTransform 配置 → 新版 Operator 列表 的桥接（单一来源）。
 *
 * 历史上 profile-handler 与 subscription-service 各有一份几乎相同的实现，唯一区别是脚本重命名：
 * 前者用 `params.dsl`（operator-runner 实际支持的形式），后者用 `params.code`
 * （operator-runner 已禁用 code，见 operator-runner.test.js）。这里统一为受支持的 `dsl` 形式，
 * 让所有 runOperatorChain 调用方共享同一条 legacy 适配路径，转换管线只有一条。
 *
 * @param {Object} config - 旧版 nodeTransform 配置
 * @returns {Array} 转换后的操作符列表（config 未启用或无任何子功能时返回空数组）
 */
export function adaptLegacyTransform(config) {
    if (!config || !config.enabled) return [];

    const ops = [];

    // 1. 过滤器 (Filter)
    const filter = config.filter;
    if (filter && (filter.include?.enabled || filter.exclude?.enabled || filter.protocols?.enabled || filter.regions?.enabled || filter.script?.enabled || filter.useless?.enabled)) {
        ops.push({ id: 'legacy-filter', type: 'filter', enabled: true, params: { ...filter } });
    }

    // 2. 正则重命名 (Regex Rename)
    const regex = config.rename?.regex;
    if (regex?.enabled && regex.rules?.length > 0) {
        ops.push({ id: 'legacy-rename-regex', type: 'rename', enabled: true, params: { regex: { ...regex } } });
    }

    // 3. 模板重命名 (Template Rename)
    const template = config.rename?.template;
    if (template?.enabled) {
        ops.push({
            id: 'legacy-rename-template',
            type: 'rename',
            enabled: true,
            params: {
                template: {
                    enabled: true,
                    template: template.template || '{emoji}{region}-{protocol}-{index}',
                    offset: template.indexStart || 1,
                    indexScope: template.indexScope || 'region'
                }
            }
        });
    }

    // 4. 重命名脚本 (Script Rename) —— 统一为 operator-runner 支持的 dsl 形式
    const renameScript = config.rename?.script;
    if (renameScript?.enabled && renameScript.expression) {
        ops.push({
            id: 'legacy-rename-script',
            type: 'script',
            enabled: true,
            params: { dsl: [{ action: 'rename', template: renameScript.expression }] }
        });
    }

    // 5. 去重 (Dedup)
    const dedup = config.dedup;
    if (dedup?.enabled) {
        ops.push({ id: 'legacy-dedup', type: 'dedup', enabled: true, params: { ...dedup } });
    }

    // 6. 排序 (Sort)
    const sort = config.sort;
    if (sort?.enabled && sort.keys?.length > 0) {
        ops.push({ id: 'legacy-sort', type: 'sort', enabled: true, params: { ...sort } });
    }

    return ops;
}
