/**
 * HTTP 层通用工具：统一错误类型、统一响应体、异步路由包装。
 */

/** 业务错误，会被全局错误处理器转换成 {ok:false, code, message} */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code 机器可读错误码
   * @param {string} message 人类可读错误信息
   * @param {Record<string, unknown>} extra 附加字段（例如 retry_after）
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = Number(status) || 500;
    this.code = code || 'ERROR';
    this.extra = extra && typeof extra === 'object' ? extra : {};
  }
}

/**
 * 断言，条件不成立时抛出 ApiError。
 * @param {unknown} condition
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function assert(condition, status, code, message) {
  if (!condition) throw new ApiError(status, code, message);
}

/**
 * 成功响应：{ok:true, ...payload}
 * @param {import('express').Response} res
 * @param {Record<string, unknown>} [payload]
 * @param {number} [status]
 */
export function ok(res, payload = {}, status = 200) {
  return res.status(status).json({ ok: true, ...payload });
}

/**
 * 失败响应（一般由全局错误处理器调用）。
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
export function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ ok: false, code, message, ...extra });
}

/**
 * 包装 async 路由处理函数，自动把异常交给 next()。
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown} fn
 * @returns {import('express').RequestHandler}
 */
export function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
