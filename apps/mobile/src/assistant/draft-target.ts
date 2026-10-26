import type { AssistantParseDto } from '@moonbud/shared'

/**
 * 草稿 → 该跳去的那个表单。这里是客户端唯一的判定点：首页只问"去哪"，
 * 表单只管"这份草稿怎么落进格子"，两边各自漂移的话，症状是"说了句话却跳到一个空表单"，
 * 而那正是这个功能最不该有的样子。
 *
 * url 上刻意什么都不带。App 端每个 navigateTo 都会把 query 的值再 encodeURIComponent 一遍
 * （uni-app-plus 的 encodeQueryString），而 onLoad 只解一次 —— 中文标题在手机上就成了
 * %E5%AE%9D…（2026-10-26 真机）。草稿改走本地一次性交接（draft-handoff.ts），
 * 那条路上没有任何编码环节，两端同一个样子。
 */
export type AssistantTarget = { kind: 'form'; url: string } | { kind: 'unknown' }

export function assistantTarget(draft: AssistantParseDto): AssistantTarget {
  if (draft.intent === 'event' && draft.event) return { kind: 'form', url: '/pages/event-form/index' }
  if (draft.intent === 'reminder' && draft.reminder) return { kind: 'form', url: '/pages/reminder-form/index' }
  // unknown，以及"意图说了却没带负载"（服务端已经挡掉，这里只是不让它长出半个跳转）。
  return { kind: 'unknown' }
}
