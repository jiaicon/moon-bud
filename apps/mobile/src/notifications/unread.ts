import { notificationsApi } from '../api/endpoints'

/**
 * 未读数只要总数：pageSize=1 拿 total，不让服务端把整页通知搬过来。
 *
 * 读不到返回 `null`，不是 0：0 是一句断言（"确实没有未读"），拿它去摘角标，
 * 屏幕就在离线时替用户宣布"没有要看的"。调用方自己决定怎么对待"不知道"。
 */
export async function fetchUnreadCount(): Promise<number | null> {
  try {
    const page = await notificationsApi.list({ unreadOnly: 'true', pageSize: 1 })
    return page.total
  } catch {
    return null
  }
}
