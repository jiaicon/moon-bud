import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FamilyDto, MemberDto, ReminderDto } from '@moonbud/shared'

vi.mock('../../api/endpoints', () => ({
  remindersApi: { list: vi.fn() },
  membersApi: { list: vi.fn() },
  familiesApi: { list: vi.fn() },
}))

import { familiesApi, membersApi, remindersApi } from '../../api/endpoints'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'
import { armReminders, type ArmableReminder, clearLocalNotifications, SCHEDULE_KEY } from '../local-notify'
import { armFromLists, resyncActiveReminderSchedules } from '../reminder-arming'

interface Row {
  owner: string
  family: string
  title: string
  body: string
  at: number
}

function rows(): Row[] {
  const stored = uni.getStorageSync(SCHEDULE_KEY)
  return stored && typeof stored === 'object' ? (Object.values(stored) as Row[]) : []
}

const recurring = (over: Partial<ReminderDto> = {}): ReminderDto => ({
  id: 'r1',
  familyId: 'f1',
  childId: null,
  title: '该挤奶了',
  note: null,
  type: 'RECURRING',
  dueAt: null,
  rrule: 'FREQ=DAILY;BYHOUR=20;BYMINUTE=00',
  timezone: 'Asia/Shanghai',
  assigneeId: null,
  status: 'ACTIVE',
  createdBy: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  overdueSince: null,
  ...over,
})

const daily = (id: string, title: string): ArmableReminder => ({
  id,
  title,
  body: '全家',
  type: 'RECURRING',
  dueAt: null,
  rrule: 'FREQ=DAILY;BYHOUR=20;BYMINUTE=00',
  timezone: 'Asia/Shanghai',
})

const family = (id: string): FamilyDto => ({ id, name: id, ownerId: 'u1', role: 'OWNER', archivedAt: null })

const members: MemberDto[] = [
  { id: 'm1', userId: 'u1', role: 'OWNER', displayName: '妈妈', joinedAt: '', nickname: '妈妈', username: 'mama' },
  { id: 'm2', userId: 'u2', role: 'MEMBER', displayName: null, joinedAt: '', nickname: '爸爸', username: 'baba' },
]

function signIn(families: FamilyDto[] = [family('f1')]): void {
  const auth = useAuthStore()
  auth.user = { id: 'u1', username: 'mama', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null }
  auth.token = 'at'
  const fam = useFamilyStore()
  fam.families = families
  fam.switchFamily(families[0]?.id ?? null)
}

function emptyTodo(): void {
  ;(remindersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 })
  ;(membersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue(members)
}

describe('提醒排期的装配', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clearLocalNotifications()
  })

  it('推送正文说的是"该谁起身"，标题说的是做什么', () => {
    armFromLists('f1', [recurring()], members, ['f1'])
    expect([...new Set(rows().map((r) => r.body))]).toEqual(['全家'])

    armFromLists('f1', [recurring({ id: 'r2', assigneeId: 'u2' })], members, ['f1'])
    expect([...new Set(rows().map((r) => r.body))]).toEqual(['爸爸'])

    armFromLists('f1', [recurring({ id: 'r3', assigneeId: 'u9' })], members, ['f1'])
    expect([...new Set(rows().map((r) => r.body))]).toEqual(['家人'])
  })

  it('正文与标题都带上，一条重复提醒占好几行', () => {
    armFromLists('f1', [recurring()], members, ['f1'])
    const armed = rows()
    expect(armed.length).toBeGreaterThanOrEqual(2)
    for (const row of armed) {
      expect(row.owner).toBe('r1')
      expect(row.family).toBe('f1')
      expect(row.title).toBe('该挤奶了')
    }
  })

  it('登录状态和家庭都齐了才去拉，且拉的是这一家的待办', async () => {
    signIn()
    emptyTodo()
    await resyncActiveReminderSchedules()
    expect(remindersApi.list).toHaveBeenCalledWith('f1', 'ACTIVE', { page: 1, pageSize: 100 })
  })

  it('待办超过一页时逐页收齐：第二页的提醒照样要响', async () => {
    // 只取第一页的话，第二页那几条既不会进表，也不会被"这一家还有哪些待办"
    // 的判断抹掉——排期按旧的半份名单走，人等不到本该响的提醒。
    signIn()
    const many = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => recurring({ id: `r${from + i}` }))
    ;(remindersApi.list as ReturnType<typeof vi.fn>).mockImplementation(
      async (_f: string, _s: string, opts: { page?: number }) =>
        opts.page === 2
          ? { items: many(101, 5), total: 105, page: 2, pageSize: 100 }
          : { items: many(1, 100), total: 105, page: 1, pageSize: 100 },
    )
    ;(membersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue(members)

    await resyncActiveReminderSchedules()

    expect(remindersApi.list).toHaveBeenCalledTimes(2)
    expect(rows().some((r) => r.owner === 'r105')).toBe(true)
  })

  it('没登录时一个请求都不发', async () => {
    await resyncActiveReminderSchedules()
    expect(remindersApi.list).not.toHaveBeenCalled()
    expect(membersApi.list).not.toHaveBeenCalled()
  })

  it('拉不到就什么都不动：旧排期还在，好过把表清空', async () => {
    signIn()
    armReminders('f1', [daily('r1', '该挤奶了')], ['f1'])
    const before = rows()
    expect(before.length).toBeGreaterThan(0)
    ;(remindersApi.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('网络不给力'))
    ;(membersApi.list as ReturnType<typeof vi.fn>).mockResolvedValue(members)
    await resyncActiveReminderSchedules()
    expect(rows()).toEqual(before)
  })

  it('服务端说这一家没有待办了，表里这一家就清空', async () => {
    signIn()
    armReminders('f1', [{ ...daily('r1', '该挤奶了'), type: 'ONE_TIME', rrule: null, dueAt: new Date(Date.now() + 3_600_000).toISOString() }], ['f1'])
    expect(rows()).toHaveLength(1)
    emptyTodo()
    await resyncActiveReminderSchedules()
    expect(rows()).toEqual([])
  })

  it('账号名下已经没有的那个家，重算后它的排期不留', async () => {
    // f2 刚被归档/退出：家庭名单里不再有它，可表里还留着它那几天的推送。
    // 别的家庭那一次重算不会碰它，谁都不清它就一直在响。
    signIn([family('f1')])
    armReminders('f2', [daily('z', 'f2 的提醒')], ['f1', 'f2'])
    expect(rows().filter((r) => r.family === 'f2').length).toBeGreaterThan(0)
    emptyTodo()
    await resyncActiveReminderSchedules()
    expect(rows().filter((r) => r.family === 'f2')).toEqual([])
  })

  it('最后一个家庭也归档/退出了，表里不再留着它的推送', async () => {
    // 归档掉最后一家之后 currentFamilyId 是空的：这时候"没什么可重算的"不等于
    // "什么都不用动"——那几天的推送还压在表里，而再没有人会来重算它。
    signIn([])
    armReminders('f2', [daily('z', 'f2 的提醒')], ['f2'])
    expect(rows().length).toBeGreaterThan(0)
    ;(familiesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await resyncActiveReminderSchedules()
    expect(rows()).toEqual([])
    expect(remindersApi.list).not.toHaveBeenCalled()
  })

  it('家庭名单读不出来时什么都不动：空名单不是"名下没有家庭"的证据', async () => {
    signIn([])
    armReminders('f2', [daily('z', 'f2 的提醒')], ['f2'])
    const before = rows()
    ;(familiesApi.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('网络不给力'))
    await resyncActiveReminderSchedules()
    expect(rows()).toEqual(before)
  })

  it('家庭名单还没读出来时先读一次，别拿一份空名单当账号名下的全部', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', username: 'mama', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null }
    auth.token = 'at'
    uni.setStorageSync('currentFamilyId', 'f1')
    armReminders('f2', [daily('z', 'f2 的提醒')], ['f1', 'f2'])
    ;(familiesApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([family('f1'), family('f2')])
    emptyTodo()
    await resyncActiveReminderSchedules()
    expect(familiesApi.list).toHaveBeenCalled()
    // 读到的是两家：这一家重算不该把还名下的 f2 抹掉。
    expect(rows().filter((r) => r.family === 'f2').length).toBeGreaterThan(0)
  })
})
