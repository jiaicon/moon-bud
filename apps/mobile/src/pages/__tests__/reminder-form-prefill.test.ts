import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 和 event-form-prefill 同一套路：这一段是 onLoad 的接线，改的是七个 ref，
 * 抽不出纯函数，就扫源码钉住顺序与"量不出来的不说"。
 */
const page = readFileSync(join(__dirname, '..', 'reminder-form', 'index.vue'), 'utf8')

const at = (needle: string): number => {
  const i = page.indexOf(needle)
  expect(i, `源码里没有 ${needle}`).toBeGreaterThan(-1)
  return i
}

/** 助手预填那一段：从取草稿到 `if (!id) return` 之前。 */
const askBlock = (): string => page.slice(at('const asked = id ? null'), at('if (!id) return'))

describe('新建提醒的助手预填', () => {
  it('草稿从本地交接取，url 上不留任何助手参数（App 端 navigateTo 会把 query 再编码一遍）', () => {
    expect(page).toContain('takeReminderDraft()')
    expect(page).not.toContain('query?.title')
    expect(page).not.toContain('query?.rrule')
    expect(page).not.toContain('query?.actionPayload')
  })

  it('编辑那一路不取草稿：一次编辑不该把助手那句话白白烧掉', () => {
    // id 在上一句才拿到，所以取用点必须排在它之后；编辑分支自己从服务端取值。
    expect(at('const asked = id ? null : takeReminderDraft()')).toBeGreaterThan(
      at("const id = String(query?.id ?? '')"),
    )
  })

  it('助手带来的 rrule 走 parseRruleForUi 还原成 UI 状态，而不是自己拆字符串', () => {
    expect(page).toContain('parseRruleForUi(askedRrule)')
    expect(page).toContain('presetKey.value = parsed.key')
    expect(page).toContain('customKind.value = parsed.kind')
    expect(page).toContain('everyN.value = String(parsed.n ?? 2)')
    expect(page).toContain('weekday.value = parsed.weekday ?? 0')
  })

  it('rrule 解析不出来就只当时钟预填，周期档位留在原样（不谎报"每天"）', () => {
    const parsed = at('const parsed = parseRruleForUi(askedRrule)')
    expect(page.slice(parsed, at('isRecurring.value = true'))).toContain('if (parsed) {')
    // isRecurring 只在带上了 rrule 且真解析出来时置真。
    expect(at('isRecurring.value = true')).toBeGreaterThan(at('const askedRrule'))
    expect(at('isRecurring.value = true')).toBeLessThan(at('presetKey.value = parsed.key'))
    expect(page.slice(parsed, at('weekday.value = parsed.weekday ?? 0'))).toContain('isRecurring.value = true')
  })

  it('带动作的预填要让提示语说实话：不合格的动作预填照样显示"到点打开记一笔"', () => {
    expect(page).toContain('actionValues[field.name] = String(value)')
    // 就绪与否仍由 actionReady 那一条算，预填不写死它；也不碰"上次存好的那一份"。
    expect(askBlock()).not.toContain('actionReady')
    expect(askBlock()).not.toContain('storedType.value')
    expect(askBlock()).not.toContain('storedPayload.value')
  })

  it('标题超长不越过 input 的 maxlength（50）', () => {
    expect(page).toContain('askedTitle.slice(0, 50)')
    // 为什么截：input 的 maxlength 就是 50，不截会在保存时静默少字。
    expect(page.slice(at('askedTitle.slice(0, 50)') - 400, at('askedTitle.slice(0, 50)'))).toContain(
      'maxlength',
    )
  })

  it('脏钟点不入库，且落在 syncWallPrefill 之后', () => {
    expect(page).toContain('/^\\d{4}-\\d{2}-\\d{2}$/.test(askedDate)')
    expect(page).toContain('/^\\d{2}:\\d{2}$/.test(askedTime)')
    expect(at('syncWallPrefill()')).toBeLessThan(at('date.value = askedDate'))
  })

  it('周期提醒的钟点从 rrule 里读回来，不落在打开页面的那一刻', () => {
    // 「每天早 8 点提醒吃维D」这种草稿只有 rrule、没有 dueAtWallClock。
    // 不读 parsed.hour/minute 的话表单显示的是打开页面的那一刻，保存又按它重拼规则——
    // 于是提醒永远在 21:47 响。编辑那一路早就这么读（同一个口径），预填不能漏。
    const block = page.slice(at('const parsed = parseRruleForUi(askedRrule)'), at('const askedChildId'))
    expect(block).toContain('time.value =')
    expect(block).toContain('parsed.hour')
    expect(block).toContain('parsed.minute')
    // 和编辑那一路同样的补零，否则 '8:00' 存不进 /^\d{2}:\d{2}$/ 的读回口径。
    expect(block).toContain('padStart(2')
  })

  it('助手带来的孩子要落进表单：带动作却没归属，保存那一刻会被服务端挡掉', () => {
    expect(askBlock()).toContain('asked.childId')
    // 只认这一家的孩子：野 id 会让表单显示"已选中"，提醒却挂在一个陌生孩子身上。
    expect(page).toContain('children.value.some((c) => c.id === askedChildId)')
    // 孩子要先于动作：动作类型那一段得知道"挂在谁身上"才算填好。
    expect(at('const askedChildId')).toBeLessThan(at('const askedEventType'))
  })
})
