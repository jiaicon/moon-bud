import type { NotificationDto } from '@moonbud/shared'
import { notificationsApi, type EventCreateInput } from '../api/endpoints'
import { useOutboxStore } from '../stores/outbox'
import { refreshUnreadTabBadge } from './tab-badge'

/**
 * 到点通知上的那个按钮该干什么，整个客户端只在这里判一次。
 * 弹框（due-watch）和通知中心（notification-list）都拿同一个出口，
 * 否则两处会各写一套"什么时候能直接记"，而这两套迟早不一致。
 */
export type QuickRecordPlan =
  | { kind: 'none' }
  | { kind: 'record'; label: '记一笔'; familyId: string; input: EventCreateInput }
  | { kind: 'form'; label: '去记一笔'; url: string }

export function quickRecordPlan(item: NotificationDto, now: Date): QuickRecordPlan {
  const action = item.action
  if (!action) return { kind: 'none' }
  // 这里不重跑 zod，也不自己判孩子还在不在：服务端已经保证 payload 要么 null、
  // 要么通过完整校验、要么那条动作已经因为孩子归档被置空。
  // 客户端再判一次只会造出"服务端说能记、客户端说不能"这种两处结论打架的 bug，
  // 而且客户端**看不见**归档的孩子（列表接口就不返回），它连判的资格都没有。
  if (action.payload === null) {
    // 预填不完整（只有类型）或者孩子已归档 —— 都不能直接写库，跳表单让人改。
    // 但表单得知道这一笔是给哪个孩子、哪一家、哪条提醒记的：只带类型过去的话，
    // 表单按"当前孩子"落笔，人刚从另一个孩子的通知点进来就记到别人身上了，
    // 而屏幕上那句"记录对象"还是事后才发现的。
    const q = encodeURIComponent
    const url =
      `/pages/event-form/index?type=${q(action.eventType)}&childId=${q(action.childId)}` +
      `&familyId=${q(item.familyId)}&reminderId=${q(action.reminderId)}`
    return { kind: 'form', label: '去记一笔', url }
  }
  return {
    kind: 'record',
    label: '记一笔',
    // 只认通知自己说的是哪一家：人可能正停在另一个家庭的页面上看这条通知。
    familyId: item.familyId,
    input: {
      childId: action.childId,
      type: action.eventType,
      // 记的是"我现在补的这一笔"，不是通知生成的那一刻（旧通知可以隔天再点）。
      occurredAt: now.toISOString(),
      payload: action.payload,
      fromReminderId: action.reminderId,
      note: null,
    },
  }
}

/**
 * 写完就把这条通知收掉：排队那一档也算成功——记录迟早会同步上去，
 * 而通知继续挂在未读里只会让人再点一次。
 */
export async function submitQuickRecord(
  plan: Extract<QuickRecordPlan, { kind: 'record' }>,
  notificationId: string,
): Promise<'saved' | 'queued'> {
  const result = await useOutboxStore().submitCreate(plan.familyId, plan.input)
  try {
    await notificationsApi.markRead(notificationId)
  } catch (err) {
    // 标已读失败不拦路：这一笔已经记上了，为一次标已读弹错误框是把重点搞反了。
    console.warn('[quick-record] 标记通知已读失败：', err)
  }
  await refreshUnreadTabBadge()
  return result.kind === 'saved' ? 'saved' : 'queued'
}
