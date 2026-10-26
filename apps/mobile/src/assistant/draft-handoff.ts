import type { AssistantEventDraft, AssistantParseDto, AssistantReminderDraft } from '@moonbud/shared'

const HANDOFF_KEY = 'assistantDraft'

/**
 * 只在"刚说完那句话"的一小段时间内算数。跳转失败（游客、页面栈满）会把草稿留在本地，
 * 十分钟后再手动打开表单还拿它预填，就等于把一句旧话当成新说的。
 */
const FRESH_MS = 10 * 60 * 1000

interface Staged {
  draft: AssistantParseDto
  childId: string | null
  stagedAt: number
}

export interface PickedEvent {
  event: AssistantEventDraft
  childId: string | null
  /** 服务端没能落进草稿的那些栏——表单顶部那条横幅要说"没填上"，靠的就是这份名单。 */
  dropped: string[]
}

export interface PickedReminder {
  reminder: AssistantReminderDraft
  childId: string | null
  dropped: string[]
}

export function stageDraft(
  input: { draft: AssistantParseDto; childId: string | null },
  now: number = Date.now(),
): void {
  const staged: Staged = { ...input, stagedAt: now }
  uni.setStorageSync(HANDOFF_KEY, staged)
}

/**
 * 取走那一页要的草稿。三条规矩：
 * - 不是这一页的意图就原样留着（人可能退回首页再进另一张表单），所以**不消费**；
 * - 过期或形状不对就丢掉，本地不留垃圾；
 * - 取到手才 removeStorageSync —— 一张表单只会被预填一次。
 *
 * 为什么不走 url：App 端每个 navigateTo 都会把 query 值再 encodeURIComponent 一遍
 * （uni-app-plus 的 encodeQueryString），而 onLoad 只解一次，
 * 于是"宝宝该吃维D"到手机上就是 %E5%AE%9D…。本地交接根本不经过编码这一层，两端同一个样子。
 */
function take(intent: 'event' | 'reminder', now: number): Staged | null {
  const staged = uni.getStorageSync(HANDOFF_KEY) as Staged | ''
  if (!staged || typeof staged !== 'object') return null
  if (typeof staged.stagedAt !== 'number' || now - staged.stagedAt > FRESH_MS) {
    uni.removeStorageSync(HANDOFF_KEY)
    return null
  }
  if (staged.draft?.intent !== intent) return null
  uni.removeStorageSync(HANDOFF_KEY)
  return staged
}

export function takeEventDraft(now: number = Date.now()): PickedEvent | null {
  const staged = take('event', now)
  const event = staged?.draft.event ?? null
  if (!staged || !event) return null
  return { event, childId: staged.childId, dropped: staged.draft.dropped ?? [] }
}

export function takeReminderDraft(now: number = Date.now()): PickedReminder | null {
  const staged = take('reminder', now)
  const reminder = staged?.draft.reminder ?? null
  if (!staged || !reminder) return null
  return { reminder, childId: staged.childId, dropped: staged.draft.dropped ?? [] }
}
