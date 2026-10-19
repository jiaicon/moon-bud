import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  familiesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    leave: vi.fn(),
    transfer: vi.fn(),
  },
}))

import { familiesApi } from '../../api/endpoints'
import { useFamilyStore } from '../family'

const f1 = { id: 'f1', name: '一家', ownerId: 'u1', role: 'OWNER', archivedAt: null }
const f2 = { id: 'f2', name: '二家', ownerId: 'u1', role: 'ADMIN', archivedAt: null }

describe('family store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uni.setStorageSync('currentFamilyId', '')
    ;(familiesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([f1, f2])
  })

  it('退出当前家庭后，选中项落到还剩下的家庭并写回 storage', async () => {
    const store = useFamilyStore()
    await store.load()
    store.switchFamily('f1')
    ;(familiesApi.leave as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    expect(await store.leave('f1')).toBe(true)
    expect(store.currentFamilyId).toBe('f2')
    expect(uni.getStorageSync('currentFamilyId')).toBe('f2')
  })

  it('后端拒绝时（最后一名所有者）不假装成功', async () => {
    const store = useFamilyStore()
    await store.load()
    ;(familiesApi.leave as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('家庭至少要有一个人管理'))

    expect(await store.leave('f1')).toBe(false)
    expect(store.error).toBe('家庭至少要有一个人管理')
    expect(store.families.map((f) => f.id)).toEqual(['f1', 'f2'])
  })

  it('转让成功后重新拉家庭列表：本地 role 已经过时', async () => {
    const store = useFamilyStore()
    await store.load()
    store.switchFamily('f1')
    ;(familiesApi.transfer as ReturnType<typeof vi.fn>).mockResolvedValue({ ...f1, ownerId: 'u2' })
    ;(familiesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...f1, role: 'ADMIN' }, { ...f2, role: 'OWNER' }])

    expect(await store.transfer('f1', 'u2')).toBe(true)
    expect(familiesApi.transfer).toHaveBeenCalledWith('f1', 'u2')
    expect(store.currentFamily?.role).toBe('ADMIN')
    expect(store.currentFamilyId).toBe('f1')
  })

  it('转让被拒绝时不刷新、不假装成功', async () => {
    const store = useFamilyStore()
    await store.load()
    ;(familiesApi.transfer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('只有创建者能转让'))

    expect(await store.transfer('f1', 'u2')).toBe(false)
    expect(store.error).toBe('只有创建者能转让')
    expect(familiesApi.list).toHaveBeenCalledTimes(1)
  })
})
