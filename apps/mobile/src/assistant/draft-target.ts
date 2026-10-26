import type { AssistantParseDto } from '@moonbud/shared'

/**
 * 草稿 → 该跳去的那个表单。这里是客户端唯一的判定点：首页只问"去哪"，
 * 表单只管"这几个键怎么用"，两边各自漂移的话，症状是"说了句话却跳到一个空表单"，
 * 而那正是这个功能最不该有的样子。
 */
export type AssistantTarget = { kind: 'form'; url: string } | { kind: 'unknown' }

export interface AssistantTargetContext {
  familyId: string
  /** 当前家庭里没有孩子时为 null：不塞这个参数，让表单自己说"未选择孩子"。 */
  childId: string | null
}

/** `YYYY-MM-DDTHH:mm` → 表单上的两个选择器值。对不上这个形状就当没带。 */
function splitWall(value: string | null): { date: string; time: string } | null {
  if (!value) return null
  const [date, time] = value.split('T')
  if (!date || !time) return null
  return { date, time }
}

function payloadParam(key: string, payload: Record<string, unknown>): string[] {
  if (Object.keys(payload).length === 0) return []
  // 空对象不进 url：表单本来就按空开始填，多一个空 JSON 只是多一个能出错的地方。
  const q = encodeURIComponent
  return [`${key}=${q(JSON.stringify(payload))}`]
}

export function assistantTarget(
  draft: AssistantParseDto,
  ctx: AssistantTargetContext,
): AssistantTarget {
  const q = encodeURIComponent
  const wall = (value: string | null): string[] => {
    const parts = splitWall(value)
    // 冒号必须编码：query 的二次解析会把它当协议分隔符，把"09:30"截成"09"。
    return parts ? [`date=${parts.date}`, `time=${q(parts.time)}`] : []
  }

  if (draft.intent === 'event' && draft.event) {
    const parts = [
      `type=${q(draft.event.type)}`,
      ...(ctx.familyId ? [`familyId=${q(ctx.familyId)}`] : []),
      ...(ctx.childId ? [`childId=${q(ctx.childId)}`] : []),
      ...wall(draft.event.occurredAtWallClock),
      ...payloadParam('payload', draft.event.payload),
    ]
    return { kind: 'form', url: `/pages/event-form/index?${parts.join('&')}` }
  }

  if (draft.intent === 'reminder' && draft.reminder) {
    const r = draft.reminder
    const parts = [
      `title=${q(r.title)}`,
      // 带动作的提醒必须挂在某个孩子上（服务端对"有动作、没归属"直接 400）：
      // 少了这一格，表单看着什么都填好了，按下保存才被服务端挡回来。
      ...(ctx.childId ? [`childId=${q(ctx.childId)}`] : []),
      ...wall(r.dueAtWallClock),
      ...(r.rrule ? [`rrule=${q(r.rrule)}`] : []),
      ...(r.eventType ? [`eventType=${q(r.eventType)}`] : []),
      // 没有动作类型就没有归属：只带 actionPayload 过去会填出一栏没人要的预填。
      ...(r.eventType ? payloadParam('actionPayload', r.actionPayload) : []),
    ]
    return { kind: 'form', url: `/pages/reminder-form/index?${parts.join('&')}` }
  }

  // unknown，以及"意图说了却没带负载"（服务端已经挡掉，这里只是不造出 undefined 的 url）。
  return { kind: 'unknown' }
}
