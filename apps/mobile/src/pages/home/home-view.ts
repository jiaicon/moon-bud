import type { TodaySummary } from '../../events/summary'
import { relativeTime } from '../../events/duplicate-warning'

export type HomeView =
  | 'checking'
  | 'guest'
  | 'loading'
  | 'child-retry'
  | 'retry'
  | 'create-family'
  | 'add-child'
  | 'ready'

export interface HomeViewInput {
  /**
   * 会话的三态由 auth store 给出。游客的 `familyId` 也是空串，和"有账号但没建过家"
   * 在数据上完全一样——只有这一项能分开"来登录吧"和"创建一个家庭"。
   */
  session: 'unknown' | 'guest' | 'member'
  /** 家庭列表这次请求失败了（而不是成功且为空）。 */
  familyLoadFailed: boolean
  familyId: string
  hasChild: boolean
  /** 这个家庭的孩子名单是否已经读到过。没读到不等于没有。 */
  childrenLoaded: boolean
  /** 孩子名单这次请求失败了（而不是成功且为空）。 */
  childrenLoadFailed: boolean
}

/**
 * 这个产品的首页一句话不能撒谎：加载失败必须长成"失败了，点此重试"，
 * 因为"今天还没有"在育儿记录里读起来就是"没人喂过孩子"，家长会据此再喂一次。
 * 同一条理由管着孩子名单：还没读出来的那一瞬不是"这个家庭没有孩子"。
 * 会话那一层在最前面：还没问出来时两句都不能说，问出来是游客时后面那些家庭话都不该说。
 */
export function decideHomeView(input: HomeViewInput): HomeView {
  if (input.session === 'unknown') return 'checking'
  if (input.session === 'guest') return 'guest'
  if (!input.familyId) return input.familyLoadFailed ? 'retry' : 'create-family'
  if (!input.childrenLoaded) return input.childrenLoadFailed ? 'child-retry' : 'loading'
  if (!input.hasChild) return 'add-child'
  return 'ready'
}

export interface OverviewRow {
  key: 'feeding' | 'sleep' | 'diaper'
  label: string
  value: string
  failed: boolean
}

const FAILED_TEXT = '没加载出来'
const EMPTY_TEXT = '今天还没有'
const PLACEHOLDER_TEXT = '—'

/**
 * 游客那一屏的概览行：骨架照画，值一律短横线。
 * 这里不能借 buildOverviewRows(null) —— 它念的是"今天还没有 / 0 次"，
 * 那是一句关于某个真实孩子的断言，而游客连家庭都没有。
 */
export function buildGuestOverviewRows(): OverviewRow[] {
  return [
    { key: 'feeding', label: '最近喂奶', value: PLACEHOLDER_TEXT, failed: false },
    { key: 'sleep', label: '最近睡眠', value: PLACEHOLDER_TEXT, failed: false },
    { key: 'diaper', label: '今日换尿布', value: PLACEHOLDER_TEXT, failed: false },
  ]
}

export function buildOverviewRows(
  summary: TodaySummary | null,
  failed: boolean,
  timezone: string,
  now: Date = new Date(),
): OverviewRow[] {
  const value = (text: string) => ({ value: failed ? FAILED_TEXT : text, failed })
  return [
    {
      key: 'feeding',
      label: '最近喂奶',
      ...value(summary?.lastFeeding ? relativeTime(timezone, summary.lastFeeding.occurredAt, now) : EMPTY_TEXT),
    },
    {
      key: 'sleep',
      label: '最近睡眠',
      ...value(summary?.lastSleep ? relativeTime(timezone, summary.lastSleep.occurredAt, now) : EMPTY_TEXT),
    },
    {
      key: 'diaper',
      label: '今日换尿布',
      ...value(`${summary?.diaperCount ?? 0} 次`),
    },
  ]
}
