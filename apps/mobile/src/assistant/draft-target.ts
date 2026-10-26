import type { AssistantIntentHint, AssistantParseDto } from '@moonbud/shared'

/**
 * 草稿 → 该跳去的那个表单。这里是客户端唯一的判定点：首页只问"去哪"，
 * 表单只管"这份草稿怎么落进格子"，两边各自漂移的话，症状是"说了句话却跳到一个空表单"，
 * 而那正是这个功能最不该有的样子。
 *
 * url 上刻意什么都不带。App 端每个 navigateTo 都会把 query 的值再 encodeURIComponent 一遍
 * （uni-app-plus 的 encodeQueryString），而 onLoad 只解一次 —— 中文标题在手机上就成了
 * %E5%AE%9D…（2026-10-26 真机）。草稿改走本地一次性交接（draft-handoff.ts），
 * 那条路上没有任何编码环节，两端同一个样子。
 *
 * `draft: null` 是"这张表单空手去"：人已确认过要做什么、只是这句里没有可填的内容。
 * 交接那一格因此也拿不到东西，表单顶部的横幅不会说一句"填好了"的谎。
 */
export type AssistantTarget =
  | { kind: 'form'; url: string; draft: AssistantParseDto | null }
  | { kind: 'unknown' }

const EVENT_FORM = '/pages/event-form/index'
const REMINDER_FORM = '/pages/reminder-form/index'

export function assistantTarget(
  draft: AssistantParseDto,
  hint?: AssistantIntentHint,
): AssistantTarget {
  if (draft.intent === 'event' && draft.event) return { kind: 'form', url: EVENT_FORM, draft }
  if (draft.intent === 'reminder' && draft.reminder) return { kind: 'form', url: REMINDER_FORM, draft }
  /**
   * 认不出意图，但人已经点过"记一笔/设提醒"了——那一下是**人**给的确认，比模型的判断权威，
   * 所以这一趟要落地：留在原地再摆一遍那两颗 chip，症状是"点了一下什么也没发生"
   * （2026-10-26 线上实测，那句"今天心情不好"带 hint 重发两次，模型两次都回 unknown）。
   */
  if (hint) return { kind: 'form', url: hint === 'event' ? EVENT_FORM : REMINDER_FORM, draft: null }
  // unknown，以及"意图说了却没带负载"（服务端已经挡掉，这里只是不让它长出半个跳转）。
  return { kind: 'unknown' }
}
