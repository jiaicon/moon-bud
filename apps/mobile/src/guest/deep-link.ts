import { useAuthStore } from '../stores/auth'

/**
 * 游客可能不经任何门控就落进非 Tab 页：扫码落地、H5 把地址贴进浏览器、以后新增的入口。
 * 那些页一进来就发要凭证的请求，401 回来的文案是"登录已过期，请重新登录"——
 * 可他一次也没登录过。撒谎之外还圈死人：过期 → 首页 → 再进来 → 又过期。
 *
 * 判定只能收在这一个地方：页面自己看 token 会漏掉"会话还没问出来"这一段，
 * 于是冷启动深链进来的人被当成游客送走，而他其实是登录着的。
 * 所以先 bootstrap（同一个 family 页面并发也只会发一次），再按三态决定：
 * - member：放行，页面照自己的加载跑；
 * - guest：送回首页。首页是游客的落脚点，骨架照常画、引导就在空白处；
 *   不带 toast 说明——reLaunch 会把它一起带走，而首页那份引导说得更清楚。
 * - unknown：这一趟问不出真相（多半是连不上），既不算是游客，也不把人送走，
 *   让页面自己说"没读到，重试"。
 */
export async function blockGuestDeepLink(): Promise<boolean> {
  const authStore = useAuthStore()
  if (authStore.session === 'unknown') await authStore.bootstrap()
  if (authStore.session !== 'guest') return false
  uni.reLaunch({ url: '/pages/home/index' })
  return true
}
