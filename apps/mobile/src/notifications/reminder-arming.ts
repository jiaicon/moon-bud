import type { MemberDto, ReminderDto } from '@moonbud/shared'
import { membersApi, remindersApi } from '../api/endpoints'
import { useAuthStore } from '../stores/auth'
import { useFamilyStore } from '../stores/family'
import { armReminders, type ArmableReminder } from './local-notify'

/**
 * 锁屏上的一行字要说清"该谁起身"：标题已经说了做什么。
 * 认不出的人（退出了家庭、刚被移出成员表）说"家人"，不空着，也不报一个错。
 */
export function assigneeLabel(members: MemberDto[], assigneeId: string | null): string {
  if (!assigneeId) return '全家'
  const member = members.find((m) => m.userId === assigneeId)
  return member?.displayName || member?.nickname || '家人'
}

/** 页面手上已经有这一家的待办和成员表时，直接用它们武装，不必再发一次请求。 */
export function armFromLists(
  familyId: string,
  reminders: ReminderDto[],
  members: MemberDto[],
  knownFamilyIds: string[],
): void {
  const armable: ArmableReminder[] = reminders.map((reminder) => ({
    id: reminder.id,
    title: reminder.title,
    body: assigneeLabel(members, reminder.assigneeId),
    type: reminder.type,
    dueAt: reminder.dueAt,
    rrule: reminder.rrule,
    timezone: reminder.timezone,
  }))
  armReminders(familyId, armable, knownFamilyIds)
}

/**
 * 进前台时把这一家的排期重算一遍。
 *
 * 没有这一步，本地推送只在"保存表单"和"完成本次"两个瞬间排过一次，之后表里只剩
 * 一个已经过去的时刻：家长建好"每天 20:00"就再没打开过它，第一次响过之后这个提醒
 * 在这台手机上就哑了。重算按家庭整块替换，所以在别的设备上做完/停掉的提醒就地消失。
 *
 * 静默失败：本地通知是加分项，不该因为它弹一个错误。
 */
export async function resyncActiveReminderSchedules(): Promise<void> {
  const authStore = useAuthStore()
  const familyStore = useFamilyStore()
  if (!authStore.user) await authStore.bootstrap()
  if (!authStore.user) return

  // 家庭名单是整次重排的依据：归档/退出的那一家靠"它不在名单里"才从表里抹掉。
  // 冷启动时名单是空的（currentFamilyId 从 storage 里读回来了），所以先读一次；
  // 读不到就什么都不动——拿一份空名单当"名下没有家庭"会把别的家庭还在响的推送抹掉。
  if (familyStore.families.length === 0) {
    const loaded = await familyStore.load()
    if (!loaded) return
  }
  const knownFamilyIds = familyStore.families.map((f) => f.id)
  const familyId = familyStore.currentFamilyId
  if (!familyId) {
    // 最后一家也归档/退出了：没有哪一家要重建，但表还是得洗一遍，
    // 否则那几天的推送再没有人来清，锁屏继续为一个自己不在了的家庭报时。
    armReminders(null, [], knownFamilyIds)
    return
  }

  try {
    // pageSize 要和排期看到的范围一致：只看第一页会把第二页的提醒从表里抹掉。
    const [active, members] = await Promise.all([
      remindersApi.list(familyId, 'ACTIVE', { pageSize: 50 }),
      membersApi.list(familyId),
    ])
    armFromLists(familyId, active.items as ReminderDto[], members, knownFamilyIds)
  } catch {
    // 拉不到就什么都不动：留着旧的排期，比把表清空更靠近真相。
  }
}
