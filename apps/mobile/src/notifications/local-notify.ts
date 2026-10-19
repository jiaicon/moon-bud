/**
 * 本地通知是加分项，站内提醒中心才是 v1 的主力（spec 第 6 节）。
 * 这里必须用条件编译而不是运行时判断：鸿蒙端没有 plus API，
 * 而 `if (typeof plus !== 'undefined')` 在编译期挡不住对 plus 的引用。
 */

interface ScheduledNotification {
  id: string
  title: string
  body: string
  /** 触发时刻的毫秒数：storage 里存 Date 会被序列化掉。 */
  at: number
}

const SCHEDULED_KEY = 'localNotifications'

function readScheduled(): Record<string, ScheduledNotification> {
  const stored = uni.getStorageSync(SCHEDULED_KEY)
  return stored && typeof stored === 'object' ? (stored as Record<string, ScheduledNotification>) : {}
}

/**
 * plus 只有"清空全部本地排期"，没有"按 id 撤销一条"。
 * 因此把排期记在本地，每次改动都清空后按登记表重建 ——
 * 否则撤销一个提醒会顺手抹掉全家其它提醒的推送。
 */
function rescheduleAll(scheduled: Record<string, ScheduledNotification>): void {
  uni.setStorageSync(SCHEDULED_KEY, scheduled)
  // #ifdef APP-PLUS
  plus.push.clear()
  for (const record of Object.values(scheduled)) {
    if (record.at <= Date.now()) continue
    plus.push.createMessage(record.body, JSON.stringify({ id: record.id }), {
      title: record.title,
      when: new Date(record.at),
    })
  }
  // #endif
}

export function scheduleLocalNotification(params: { id: string; title: string; body: string; at: Date }): void {
  // #ifndef APP-PLUS
  console.warn('[moonBud] 当前平台不支持本地通知，提醒仅出现在站内提醒中心')
  // #endif
  // 同 id 覆盖：编辑提醒时旧排期不会留下第二条。
  rescheduleAll({
    ...readScheduled(),
    [params.id]: { id: params.id, title: params.title, body: params.body, at: params.at.getTime() },
  })
}

export function cancelLocalNotification(id: string): void {
  const scheduled = readScheduled()
  if (!(id in scheduled)) return
  delete scheduled[id]
  rescheduleAll(scheduled)
}

/**
 * 冷启动重建一次：登记表里已经过期的条目会被丢掉（rescheduleAll 跳过 at<=now），
 * 还没到的重新排上。不这么做，App 关着的时候攒下的过期条目会一直留在表里，
 * 而下一次任何改动都会把它们和真实排期一起重放。
 */
export function rearmLocalNotifications(): void {
  rescheduleAll(readScheduled())
}
