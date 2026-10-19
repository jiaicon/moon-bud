import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  childrenApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

import { childrenApi } from '../../api/endpoints'
import { useChildStore } from '../child'

const childA = { id: 'c-a', familyId: 'f1', name: '大宝', gender: 'UNKNOWN', birthday: '2025-01-01', avatarUrl: null, archivedAt: null }
const childB = { id: 'c-b', familyId: 'f2', name: '二宝', gender: 'UNKNOWN', birthday: '2026-01-01', avatarUrl: null, archivedAt: null }

describe('child store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(childrenApi.list as ReturnType<typeof vi.fn>).mockImplementation((familyId: string) =>
      Promise.resolve(familyId === 'f1' ? [childA] : [childB]))
  })

  it('当前孩子按家庭分别记录，互不串台', async () => {
    const store = useChildStore()
    await store.load('f1')
    await store.load('f2')
    store.select('f1', 'c-a')
    store.select('f2', 'c-b')
    expect(store.currentChild('f1')?.name).toBe('大宝')
    expect(store.currentChild('f2')?.name).toBe('二宝')
  })

  it('没有选择过时回退到该家庭第一个孩子', async () => {
    const store = useChildStore()
    await store.load('f1')
    expect(store.currentChild('f1')?.id).toBe('c-a')
  })

  it('记住的孩子已被归档时回退到第一个', async () => {
    const store = useChildStore()
    await store.load('f1')
    store.select('f1', 'c-a')
    ;(childrenApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await store.load('f1')
    expect(store.currentChild('f1')).toBeNull()
  })

  it('记住的孩子不属于该家庭时不返回它', async () => {
    const store = useChildStore()
    await store.load('f2')
    store.select('f1', 'c-a')
    expect(store.currentChild('f2')?.id).toBe('c-b')
  })

  it('零个孩子的家庭返回 null 而不抛错', async () => {
    ;(childrenApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const store = useChildStore()
    await store.load('f1')
    expect(store.currentChild('f1')).toBeNull()
  })

  it('改完的孩子立刻反映在缓存里，不必重拉', async () => {
    const store = useChildStore()
    await store.load('f1')
    ;(childrenApi.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...childA, name: '大宝改名' })

    expect(await store.update('f1', 'c-a', { name: '大宝改名' })).toBe(true)
    expect(store.childrenByFamily.f1[0].name).toBe('大宝改名')
  })

  it('改失败时说出后端的原因，缓存保持原样', async () => {
    const store = useChildStore()
    await store.load('f1')
    ;(childrenApi.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('只有管理员能改'))

    expect(await store.update('f1', 'c-a', { name: '随便' })).toBe(false)
    expect(store.error).toBe('只有管理员能改')
    expect(store.childrenByFamily.f1[0].name).toBe('大宝')
  })

  it('删掉正被选中的孩子后，选中标记跟着消失', async () => {
    const store = useChildStore()
    await store.load('f1')
    store.select('f1', 'c-a')
    ;(childrenApi.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    expect(await store.remove('f1', 'c-a')).toBe(true)
    // 旧 id 留着会让下一次 currentChild 指着一个不存在的孩子；select('') 那条路
    // 被"成员检查"挡住了，所以必须显式清掉。
    expect(store.currentChildIdByFamily.f1).toBeUndefined()
  })
})
