import { notificationsApi } from '../api/endpoints'

/**
 * 未读数只要总数：pageSize=1 拿 total，不让服务端把整页通知搬过来。
 * 失败时返回 0 —— 角标读不到不该把页面变成错误页。
 */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const page = await notificationsApi.list({ unreadOnly: 'true', pageSize: 1 })
    return page.total
  } catch {
    return 0
  }
}
