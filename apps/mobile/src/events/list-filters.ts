import type { EventType, MemberDto } from '@moonbud/shared'
import type { Query } from '../api/http'

export interface EventListFilters {
  type?: EventType | ''
  childId?: string
  createdBy?: string
}

/**
 * 把界面上的筛选项拼成查询串。
 *
 * 空字符串一律丢掉：`createdBy=` 到了后端是非法 UUID，直接 400；而"没选"和
 * "选了空"在界面上是同一件事。
 */
export function buildEventQuery(filters: EventListFilters, page: number, pageSize: number): Query {
  const query: Query = { page, pageSize }
  if (filters.type) query.type = filters.type
  if (filters.childId) query.childId = filters.childId
  if (filters.createdBy) query.createdBy = filters.createdBy
  return query
}

export interface RecorderOption {
  value: string
  label: string
}

/**
 * "按记录人筛"那一行的芯片：`''` 是"全部"。
 *
 * 少于两个人返回空数组——一个人的家庭问"谁记的"没有意义，画一行只有"全部"
 * 的芯片是把界面写成假功能。名单还没读到时同样返回空：那一行不该出现，
 * 页面自己说"名单正在读取"。
 */
export function recorderOptions(members: MemberDto[], selfUserId: string): RecorderOption[] {
  if (members.length < 2) return []
  return [
    { value: '', label: '全部' },
    ...members.map((m) => ({
      value: m.userId,
      label: (m.userId === selfUserId && selfUserId ? '我' : m.displayName || m.nickname),
    })),
  ]
}

/**
 * 列表空下来时屏幕该说什么。
 *
 * 带着筛项空着 ≠ 家里没有记录：把"还没有记录"印在"爷爷 + 喂奶"的筛选下面，
 * 是在告诉用户一件他没问过的事，也让人以为记录丢了（spec 第 2 节的反目标）。
 */
export function emptyListCopy(activeFilters: string[]): { title: string; hint: string } {
  if (activeFilters.length === 0) {
    return { title: '还没有记录', hint: '点右下角 ＋，喂奶、换尿布、睡觉都能记一条。' }
  }
  return {
    title: '这个筛选下还没有记录',
    hint: `当前筛的是：${activeFilters.join('、')}。换个筛项，或点右下角 ＋ 记一条。`,
  }
}
