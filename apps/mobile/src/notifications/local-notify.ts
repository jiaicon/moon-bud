import { occurrencesWithinWindow, type WindowSource } from '../reminders/occurrence-window'

/**
 * 本地通知是加分项，站内提醒中心才是 v1 的主力（spec 第 6 节）。
 * 这里必须用条件编译而不是运行时判断：鸿蒙端没有 plus API，
 * 而 `if (typeof plus !== 'undefined')` 在编译期挡不住对 plus 的引用。
 */

/** 一条已排好的推送：plus 只认"某个时刻响一次"。 */
interface ScheduledRow {
  /** 归属的提醒 id。一个提醒在窗口里可能占好几条，撤销要能按它找齐。 */
  owner: string
  /** 归属的家庭 id：重建排期按家庭为单位，不能顺手抹掉另一个家庭的提醒。 */
  family: string
  title: string
  body: string
  /** 触发时刻的毫秒数：storage 里存 Date 会被序列化掉。 */
  at: number
}

/** 要武装的东西：一条提醒 + 推送上显示的字。 */
export interface ArmableReminder extends WindowSource {
  id: string
  title: string
  body: string
}

export const SCHEDULE_KEY = 'localNotifications'

// #ifndef APP-PLUS
// H5/小程序里排期只是写进本地登记表、不会真的响。说一次，别让人以为提醒坏了；
// 每次进前台都喊一遍就成了噪音，所以只说一次。
let warnedUnsupported = false
// #endif

/**
 * 本地排期只是兜底，默认关。
 *
 * plus 的定时消息一旦排上就**撤不掉**：官方《Push 推送开发指南》写的是 `clear()` 清空
 * "系统通知栏中属于当前应用的所有消息"，还没到点、压在队列里的那条它碰不到 —— 真机验过，
 * 停掉提醒之后旧时刻照响。而服务端推送是到点那一刻才决定发不发，停掉/改时间天然作废。
 * 所以这台设备上报到了 cid（推送通道可用）就不要再排本地，否则"我叫它别再响了"做不到。
 */
let localPushEnabled = false

export function setLocalPushEnabled(enabled: boolean): void {
  if (enabled === localPushEnabled) return
  localPushEnabled = enabled
  // 开启的那一刻把表里已有的排期补交给原生。关掉时不做反悔动作：反悔不掉，
  // 而那些消息跟着进程一起没，不会漂到下一次启动。
  if (enabled) rescheduleAll(readScheduled())
}

function readScheduled(): Record<string, ScheduledRow> {
  const stored = uni.getStorageSync(SCHEDULE_KEY)
  return stored && typeof stored === 'object' ? (stored as Record<string, ScheduledRow>) : {}
}

/** 登记表是唯一的事实，每次改动都整份重写后再按它重建原生排期。 */
function rescheduleAll(scheduled: Record<string, ScheduledRow>): void {
  uni.setStorageSync(SCHEDULE_KEY, scheduled)
  // #ifdef APP-PLUS
  if (!localPushEnabled) return
  try {
    plus.push.clear()
    for (const record of Object.values(scheduled)) {
      if (record.at <= Date.now()) continue
      plus.push.createMessage(record.body, JSON.stringify({ id: record.owner }), {
        title: record.title,
        delay: delaySeconds(record.at),
      })
    }
  } catch (e) {
    warnNativePushUnavailable(e)
  }
  // #endif
}

/**
 * 推迟显示靠的是 `delay`（秒），不是 `when`：文档里 `when` 只是"消息上显示的提示时间"，
 * 真机对照下带 `when` 的两条（plus 与 uni 各一）都在提交的那一刻就冒了出来，带 `delay`
 * 的两条才各自在 +120s / +180s 响 —— 这就是"保存即弹、到点不响"。
 *
 * 向上取整：宁可晚一秒，不要在点之前响。
 */
function delaySeconds(at: number): number {
  return Math.max(1, Math.ceil((at - Date.now()) / 1000))
}

function clearNativePush(): void {
  // #ifdef APP-PLUS
  try {
    plus.push.clear()
  } catch (e) {
    warnNativePushUnavailable(e)
  }
  // #endif
}

/**
 * APK 里没有 push 模块时，plus.push 的每个调用都会抛"打包时未添加push模块"。
 * 那句话对家长毫无意义，而且它原本会把"新建提醒"整条链路炸断 —— 登记表已经写成了，
 * 站内提醒中心与应用内的到点提示都不依赖原生 push，所以这里只吞下并留一条日志，
 * 且只说一次（每次重算都喊一遍就成了刷屏）。
 */
let nativePushWarned = false
function warnNativePushUnavailable(e: unknown): void {
  if (nativePushWarned) return
  nativePushWarned = true
  console.warn('[moonBud] 本机 APK 未包含 push 模块，本地通知不可用；提醒仍走站内提醒中心与应用内到点提示', e)
}

/**
 * 把一个家庭当前该响的提醒，在未来窗口里的每一次触发都排上。
 *
 * 只排"下一次"是不够的：家长建好"每天 20:00"之后不会再打开它的表单，第一次推送响过，
 * 表里就只剩一个已经过去的时刻，这个提醒从此哑掉。
 *
 * 传入的是这个家庭**完整**的待办列表，所以整块替换这一家的条目：在别的设备上做完或
 * 停掉的提醒，本机重算后就地消失，不会继续"该喂药了"。
 *
 * `knownFamilyIds` 是这个账号现在还名下的家庭。归档与退出都不碰别的家庭那一次重算，
 * 所以不在名单里的那个家留下的推送没人会清——人都不在这个家了，锁屏还继续"该喂药了"
 * 直到窗口过完，这就是撒谎。名单必须是完整的（空数组会把所有别的家庭抹掉）。
 *
 * `familyId` 为 null 表示这一台设备上当前没有可选家庭（最后一家也归档/退出了）：
 * 没有哪一家要重建，但表还是得按名单洗一遍，不然那几天的推送没人来清。
 */
export function armReminders(
  familyId: string | null,
  reminders: ArmableReminder[],
  knownFamilyIds: string[],
  now: Date = new Date(),
): void {
  const rebuilt: Record<string, ScheduledRow> = {}
  for (const [key, row] of Object.entries(readScheduled())) {
    // 这一家整块重建，所以它自己的旧条目一律不留。
    // 旧版一条提醒只排一次，条目里没有 family：它不属于任何一次重算，
    // 于是家庭都删了推送还压在表里。顺手一起清掉。
    if (!row.family || row.family === familyId || !knownFamilyIds.includes(row.family) || row.at <= now.getTime()) {
      continue
    }
    rebuilt[key] = row
  }
  if (familyId) {
    for (const reminder of reminders) {
      for (const at of occurrencesWithinWindow(reminder, now)) {
        rebuilt[`${reminder.id}#${at.getTime()}`] = {
          owner: reminder.id,
          family: familyId,
          title: reminder.title,
          body: reminder.body,
          at: at.getTime(),
        }
      }
    }
  }
  rescheduleAll(rebuilt)
  // #ifndef APP-PLUS
  if (!warnedUnsupported) {
    warnedUnsupported = true
    console.warn('[moonBud] 当前平台不支持本地通知，提醒仅出现在站内提醒中心')
  }
  // #endif
}

/**
 * 停掉/删掉一条提醒：本地立刻撤销它自己的排期，不等下一次重算。
 * 走网络的重算会失败（离线、后端没起来），而"我已经叫它别再响了"不该看网络脸色。
 */
export function disarmReminder(id: string): void {
  const kept = Object.entries(readScheduled()).filter(([, row]) => row.owner !== id)
  rescheduleAll(Object.fromEntries(kept))
}

/**
 * 冷启动重放一次表里的排期。定时通知由系统持有，杀进程通常还在，但设备重启、系统回收、
 * 或表里攒着过期条目都会让它不对：先清空再按表重建，顺手把过去了的死条目删掉，
 * 否则那些旧时刻会一直留在存储里，被下一次重算当现状写回。
 */
export function rearmLocalNotifications(): void {
  const now = Date.now()
  const live = Object.entries(readScheduled()).filter(([, row]) => row.family && row.at > now)
  rescheduleAll(Object.fromEntries(live))
}

/**
 * 退出登录时把所有排期撤掉。登记表存在设备级 storage 里，不清的话下一个账号
 * 在这台手机上登录，仍会收到上一个账号那个家庭的"该喂药了"。
 */
export function clearLocalNotifications(): void {
  uni.removeStorageSync(SCHEDULE_KEY)
  clearNativePush()
}
