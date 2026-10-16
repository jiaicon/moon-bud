// vitest 跑在 node 环境里，没有 uni 全局；纯逻辑模块（http / stores）通过它读写本地状态。
const storage = new Map<string, unknown>()

;(globalThis as Record<string, unknown>).uni = {
  setStorageSync: (key: string, value: unknown) => void storage.set(key, value),
  getStorageSync: (key: string) => (storage.has(key) ? storage.get(key) : ''),
  removeStorageSync: (key: string) => void storage.delete(key),
  getSystemInfoSync: () => ({ theme: 'light' }),
  request: () => {
    throw new Error('uni.request is not available in unit tests')
  },
}

// baseURL 是构建期注入的配置；测试里给一个非 localhost 的值，
// 以免 env.ts 的"缺配置即抛错"把每个用例都炸掉。
process.env.VITE_API_BASE_URL ||= 'http://env-test/api'
