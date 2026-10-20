import { notificationsApi } from '../api/endpoints'
import { getAccessToken } from '../api/http'

/**
 * 未读数只要总数：pageSize=1 拿 total，不让服务端把整页通知搬过来。
 *
 * 读不到返回 `null`，不是 0：0 是一句断言（"确实没有未读"），拿它去摘角标，
 * 屏幕就在离线时替用户宣布"没有要看的"。调用方自己决定怎么对待"不知道"。
 *
 * 本地连会话都没有就别问：那一发必定 401，而每次回到前台都问一遍，是在替
 * 一个没登录过的人反复敲一扇不开的门。
 */
export async function fetchUnreadCount(): Promise<number | null> {
  if (!getAccessToken()) return null
  try {
    const page = await notificationsApi.list({ unreadOnly: 'true', pageSize: 1 })
    return page.total
  } catch {
    return null
  }
}
