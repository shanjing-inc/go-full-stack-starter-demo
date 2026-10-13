/**
 * Taro CLI 通过插件 hook 提供组件集合；开发模式显式保留当前页面的原生控件模板。
 */
module.exports = function registerWeappComponents(ctx) {
    ctx.modifyComponentConfig(({ componentConfig }) => {
        componentConfig.includes.add("button");
        componentConfig.includes.add("input");
    });
};
