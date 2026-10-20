import { beforeEach, describe, expect, it, vi } from 'vitest'

const listMock = vi.hoisted(() => vi.fn())
const getAccessTokenMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/endpoints', () => ({ notificationsApi: { list: listMock } }))
vi.mock('../../api/http', () => ({ getAccessToken: getAccessTokenMock }))

const { fetchUnreadCount } = await import('../unread')

describe('未读数', () => {
  beforeEach(() => {
    listMock.mockReset()
    getAccessTokenMock.mockReset()
  })

  it('有会话时只要服务端给的总数', async () => {
    getAccessTokenMock.mockReturnValue('at')
    listMock.mockResolvedValue({ items: [], total: 3 })
    await expect(fetchUnreadCount()).resolves.toBe(3)
  })

  // 游客的 onShow 也会问一次未读：那次请求必定 401，而每次回到前台都问一遍，
  // 屏幕看到的是"重新登录"按钮怎么点都没有反应。没有会话就没有"未读"这回事。
  it('本地没有会话时一个字都不问：问了只会换来 401 和一次踢人', async () => {
    getAccessTokenMock.mockReturnValue(null)
    await expect(fetchUnreadCount()).resolves.toBeNull()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('读失败返回 null，不是 0：0 是一句"确实没有未读"的断言', async () => {
    getAccessTokenMock.mockReturnValue('at')
    listMock.mockRejectedValue(new Error('离线'))
    await expect(fetchUnreadCount()).resolves.toBeNull()
  })
})
