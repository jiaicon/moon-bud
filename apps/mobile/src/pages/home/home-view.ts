import type { TodaySummary } from '../../events/summary'
import { relativeTime } from '../../events/duplicate-warning'

export type HomeView = 'retry' | 'create-family' | 'add-child' | 'ready'

export interface HomeViewInput {
  /** 家庭列表这次请求失败了（而不是成功且为空）。 */
  familyLoadFailed: boolean
  familyId: string
  hasChild: boolean
}

/**
 * 这个产品的首页一句话不能撒谎：加载失败必须长成"失败了，点此重试"，
 * 因为"今天还没有"在育儿记录里读起来就是"没人喂过孩子"，家长会据此再喂一次。
 */
export function decideHomeView(input: HomeViewInput): HomeView {
  if (!input.familyId) return input.familyLoadFailed ? 'retry' : 'create-family'
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

export function buildOverviewRows(summary: TodaySummary | null, failed: boolean): OverviewRow[] {
  const value = (text: string) => ({ value: failed ? FAILED_TEXT : text, failed })
  return [
    {
      key: 'feeding',
      label: '最近喂奶',
      ...value(summary?.lastFeeding ? relativeTime(summary.lastFeeding.occurredAt) : EMPTY_TEXT),
    },
    {
      key: 'sleep',
      label: '最近睡眠',
      ...value(summary?.lastSleep ? relativeTime(summary.lastSleep.occurredAt) : EMPTY_TEXT),
    },
    {
      key: 'diaper',
      label: '今日换尿布',
      ...value(`${summary?.diaperCount ?? 0} 次`),
    },
  ]
}
