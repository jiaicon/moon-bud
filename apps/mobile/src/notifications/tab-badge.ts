import { fetchUnreadCount } from './unread'

/**
 * 底部 Tab 第 3 格（pages.json 里 `pages/reminder-list/index`）。
 * Tab 顺序变了这里要跟着变——tab-badge-wiring 测试拿 pages.json 核对它。
 */
export const REMINDER_TAB_INDEX = 2

/** 角标写不下三位数，99+ 是惯例。 */
const MAX_BADGE = 99

/**
 * 把未读数画到"提醒"那一格上。
 *
 * `null` 表示"没读到"（离线、会话过期、后端 500），这时**什么都不动**：
 * 摘掉角标是替用户宣布"没有要看的"，而真相是我不知道。
 */
export function applyUnreadBadge(count: number | null): void {
  if (count === null) return
  if (count <= 0) {
    uni.removeTabBarBadge({ index: REMINDER_TAB_INDEX })
    return
  }
  uni.setTabBarBadge({
    index: REMINDER_TAB_INDEX,
    text: count > MAX_BADGE ? `${MAX_BADGE}+` : String(count),
  })
}

/**
 * 问一次服务端再画：只要 total，不让它把整页通知搬过来。
 *
 * 冷启动时 App 的 onShow 和落地页的 onShow 会挨着触发，并发并入同一次——
 * 两次问的是同一个数，第二发是白跑的。
 */
let flight: Promise<void> | null = null

export function refreshUnreadTabBadge(): Promise<void> {
  if (flight) return flight
  flight = (async () => {
    applyUnreadBadge(await fetchUnreadCount())
  })().finally(() => {
    flight = null
  })
  return flight
}
