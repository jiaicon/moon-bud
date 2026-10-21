/** 与后端 CreateInviteDto 的 @Min(1) / @Max(24*30) 同源：客户端先问一句，别发一次 400 再翻译。 */
const MIN_HOURS = 1
const MAX_HOURS = 24 * 30

/** 页面里那个输入框的默认值；留空就是它。 */
export const DEFAULT_INVITE_HOURS = 72

export type InviteWindow = { ok: true; expiresInHours: number } | { ok: false; error: string }

/**
 * 邀请时效只有这一处解析。`Number(hours) || 72` 那种写法把"0"和"一星期"都当成没填，
 * 于是管理员以为发了一张当天的码，实际发出去是一张三天的——差别看不出来，只能靠出事以后想。
 */
export function inviteWindow(raw: string): InviteWindow {
  const text = raw.trim()
  if (text === '') return { ok: true, expiresInHours: DEFAULT_INVITE_HOURS }
  if (!/^\d+$/.test(text)) return { ok: false, error: '有效时长要填整数小时，1 到 720 之间' }
  const hours = Number(text)
  if (hours < MIN_HOURS || hours > MAX_HOURS) {
    return { ok: false, error: `有效时长要在 ${MIN_HOURS} 到 ${MAX_HOURS} 小时之间` }
  }
  return { ok: true, expiresInHours: hours }
}
