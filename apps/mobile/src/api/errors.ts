import type { ApiError } from '@moonbud/shared'

export class ApiRequestError extends Error {
  statusCode: number
  isNetworkError: boolean

  constructor(message: string, statusCode = 0, isNetworkError = false) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
    this.isNetworkError = isNetworkError
  }
}

const FALLBACK = '请求失败，请稍后重试'

function readMessage(source: unknown): string | undefined {
  if (typeof source === 'string') return source.trim() || undefined
  if (Array.isArray(source)) {
    const parts = source.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    return parts.length ? parts.join('; ') : undefined
  }
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>
    return readMessage(record.message) ?? readMessage(record.error)
  }
  return undefined
}

export function normalizeError(e: unknown): ApiRequestError {
  if (e instanceof ApiRequestError) return e

  const obj = (e ?? {}) as Record<string, unknown>

  // uni.request 的失败回调：{ errMsg: 'request:fail ...' }
  if (typeof obj.errMsg === 'string') {
    return new ApiRequestError('网络连接失败，请检查网络后重试', 0, true)
  }

  const statusCode = typeof obj.statusCode === 'number' ? obj.statusCode : 0
  const body = obj.data ?? obj
  const message = readMessage(body) ?? (statusCode >= 500 ? '服务暂时不可用，请稍后重试' : FALLBACK)
  return new ApiRequestError(message, statusCode, false)
}
