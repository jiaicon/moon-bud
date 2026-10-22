import type { NotificationDto } from '@moonbud/shared'
import { notificationsApi } from '../api/endpoints'

/** 一分钟问一次：提醒的精度就是分钟，再快也只是白跑请求。 */
const POLL_MS = 60_000
/** 一页拿 20 条：toasts 一次弹不完，而"到点"本来就极少成批发生。 */
const PAGE_SIZE = 20
/** 记住的条目封顶，防止一个长会话把见过的 id 攒成无界数组。 */
const MAX_SEEN = 200

export interface DueWatchPlan {
  /** 这一轮该在屏幕上说一声的提醒通知。 */
  surface: NotificationDto[]
  /** 下一轮带进去的"已经见过了"。 */
  seen: string[]
}

/**
 * 哪些未读通知值得打断家长一下。
 *
 * 只认 `occurrenceId !== null`：那是提醒到点生成的通知，其余（入家申请、改密请求）
 * 是"有空来看一眼"，不该在一分钟一次的轮询里突然冒出来吓人。
 *
 * `seenIds === null` 表示"第一次"——冷启动、换账号、离线之后重新读到都算。这时
 * 只记底不弹：服务端已经攒了三条的话，一次性连弹三个要人点掉的框是骚扰，不是提醒，
 * 而那三条本来就由本地推送或角标说过了。
 */
export function planDueWatch(items: NotificationDto[], seenIds: string[] | null): DueWatchPlan {
  const due = items.filter((item) => item.occurrenceId !== null)
  if (seenIds === null) return { surface: [], seen: cap(due.map((item) => item.id)) }

  const known = new Set(seenIds)
  const surface = due.filter((item) => !known.has(item.id))
  return { surface, seen: cap([...seenIds, ...surface.map((item) => item.id)]) }
}

function cap(ids: string[]): string[] {
  return ids.length > MAX_SEEN ? ids.slice(ids.length - MAX_SEEN) : ids
}

/** 一条报名字，多条只报数：一屏念不完一串名字，而要点掉的框更不该塞满。 */
export function dueWatchMessage(items: NotificationDto[]): string {
  if (items.length === 1) return `到点了：${items[0].title}`
  return `${items.length} 条提醒到点`
}

let seen: string[] | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** 屏幕上是不是已经压着一个没点掉的框。 */
let alertOpen = false

function showDueAlert(items: NotificationDto[]): void {
  alertOpen = true
  uni.showModal({
    title: '到点了',
    content: dueWatchMessage(items),
    showCancel: false,
    confirmText: '知道了',
    // 用 complete 而不是 success：不管是点确认、按返回键还是别的路子收掉，
    // 这一句都要跑到 —— 漏一次就把后面的提醒全哑掉了。
    complete: () => {
      alertOpen = false
    },
  })
}

async function tick(): Promise<void> {
  let items: NotificationDto[]
  try {
    const page = await notificationsApi.list({ unreadOnly: 'true', pageSize: PAGE_SIZE })
    items = page.items
  } catch {
    // 读不到就什么都不做：把"没读到"当成"没有到点的"是替用户下了结论。
    return
  }
  const plan = planDueWatch(items, seen)
  if (plan.surface.length === 0) {
    seen = plan.seen
    return
  }
  // 已经压着一个框就别再叠：那几条不进"见过"，等这一框点掉之后下一轮照样会弹。
  if (alertOpen) return
  seen = plan.seen
  showDueAlert(plan.surface)
}

/**
 * 应用在前台时盯着到点的提醒。
 *
 * 本地推送是"App 在后台或系统层面排定的那一响"——App 正开着时它不一定响，
 * 而家长盯着屏幕的那一刻恰恰最需要被提醒。回前台会先问一次，之后每分钟一次。
 *
 * 弹的是模态框而不是 toast：到点这件事必须被看见，而 toast 三秒就自己没了，
 * 家长正抱着孩子、手上一滑就错过了，错过之后屏幕上什么都不剩。
 */
export function startDueWatch(): void {
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), POLL_MS)
}

export function stopDueWatch(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/** 退出登录：忘掉进度并停手，否则下一个账号会被上一个账号的"已看过"骗过。 */
export function resetDueWatch(): void {
  stopDueWatch()
  seen = null
  alertOpen = false
}
