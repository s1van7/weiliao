/**
 * 应用版本号。
 *
 * 由 vite.config.js 的 define 注入（读取 web/package.json 的 version），
 * 发版时只需改 web/package.json，Web 与三端设置页会同步显示，无需改代码。
 *
 * 这里做一次 typeof 保护：万一在未经过 Vite 构建的环境（如纯 ESLint / 单元测试）
 * 里解析本文件，`__APP_VERSION__` 未定义也不会抛 ReferenceError。
 */

/* global __APP_VERSION__ */

/** 构建时注入的版本号；未注入时回退到占位版本 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

export default APP_VERSION;
