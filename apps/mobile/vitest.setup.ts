// vitest 跑在 node 环境里，没有 uni 全局；纯逻辑模块（http / stores）通过它读写本地状态。
const storage = new Map<string, unknown>()

;(globalThis as Record<string, unknown>).uni = {
  setStorageSync: (key: string, value: unknown) => void storage.set(key, value),
  getStorageSync: (key: string) => (storage.has(key) ? storage.get(key) : ''),
  removeStorageSync: (key: string) => void storage.delete(key),
  getSystemInfoSync: () => ({ theme: 'light' }),
  showModal: (opts: { success?: (res: { confirm: boolean }) => void }) => opts.success?.({ confirm: false }),
  setNavigationBarColor: () => {},
  setTabBarStyle: () => {},
  setTabBarBadge: () => {},
  removeTabBarBadge: () => {},
  showToast: () => {},
  reLaunch: () => {},
  // 推送：默认保持"H5 上不存在"的样子（getPushClientId 未定义），
  // 需要 App 分支的用例自己在用例里覆盖成 vi.fn()。
  getPushClientId: undefined,
  onPushMessage: () => {},
  navigateTo: () => {},
  switchTab: () => {},
  request: () => {
    throw new Error('uni.request is not available in unit tests')
  },
}

// 条件编译（// #ifdef APP-PLUS）只有 uni 的编译器会剥离，vitest 跑的是原始 TS，
// 里面的 plus 调用会真的执行。给一个空壳：单元测试只核对 storage，不验证原生排期。
;(globalThis as Record<string, unknown>).plus = {
  push: { clear: () => {}, createMessage: () => {} },
}

// baseURL 是构建期注入的配置；测试里给一个非 localhost 的值，
// 以免 env.ts 的"缺配置即抛错"把每个用例都炸掉。
process.env.VITE_API_BASE_URL ||= 'http://env-test/api'
