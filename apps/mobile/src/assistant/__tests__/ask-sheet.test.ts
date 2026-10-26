import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lightTokens } from '../../theme/tokens'
import { toCssVars } from '../../theme/presets'

/**
 * 面板是要素的那个组件：它的逻辑大半是"什么时候不换页、什么时候不清空、什么时候不开口"，
 * 抽不成纯函数（它改的是三个 ref），所以照本页既有路子扫源码。
 * 这里钉的四条都是"人一眼看不出、出事最难查"的那类。
 */
const sheet = readFileSync(join(__dirname, '..', '..', 'components', 'AskSheet.vue'), 'utf8')

const at = (needle: string): number => {
  const i = sheet.indexOf(needle)
  expect(i, `AskSheet.vue 里没有 ${needle}`).toBeGreaterThan(-1)
  return i
}

describe('助手面板', () => {
  it('草稿走一次性交接，不走 url：交接早于跳转，而且只在真拿到草稿时', () => {
    // url 上带中文在 App 端会被再编码一次（见 draft-handoff.ts），面板绝不能退回那一套。
    expect(sheet).toContain('if (target.draft) stageDraft({ draft: target.draft, childId: props.childId })')
    expect(at('stageDraft({ draft: target.draft')).toBeLessThan(at('uni.navigateTo({ url: target.url })'))
    expect(sheet).not.toMatch(/navigateTo\(\{ url: `\/pages\/[^\n]*\?/)
  })

  /**
   * 2026-10-26 线上实测：那句"今天心情不好"带着 intentHint 重发，模型照旧回 unknown，
   * 于是那两颗 chip 被再摆一遍——人点了一下，界面什么反应都没有。
   * 跳转的判定必须接上 hint（人确认过的那一下比模型权威），而手里没草稿时不许塞一份空草稿，
   * 否则表单顶部会念一句"助手按你说的话填好了"，而它一个字都没填。
   */
  it('点过 chip 之后不许原地打转：判定带上 hint，空手就不交接', () => {
    expect(sheet).toContain('assistantTarget(result, hint)')
    expect(sheet).toContain('if (target.draft) stageDraft')
    expect(at("if (target.kind === 'unknown')")).toBeLessThan(at('uni.navigateTo({ url: target.url })'))
  })

  it('没听懂时不换页、不清空原话，而是就地反问', () => {
    const unknown = sheet.slice(at("if (target.kind === 'unknown')"), at('stageDraft({ draft: target.draft'))
    expect(unknown).not.toContain('navigateTo')
    expect(unknown).not.toContain("text.value = ''")
    expect(unknown).toContain('clarify.value = true')
    // 那两个 chip 就是这一期的"再说一次也不丢人"。
    expect(sheet).toContain('记一笔')
    expect(sheet).toContain('设提醒')
  })

  it('确认过的意图随原话重发，而不是客户端自己拼一份草稿', () => {
    // 客户端替人判定 intent 就是第二个判定点：一期终审那一串 bug 全是两份判定漂移的产物。
    expect(sheet).toContain('assistantApi.parse(said, hint)')
    expect(sheet).toMatch(/send\('event'\)|send\("event"\)|send\(hintOf\('event'\)\)/)
    expect(sheet).toMatch(/send\('reminder'\)|send\("reminder"\)|send\(hintOf\('reminder'\)\)/)
  })

  it('原话清空只发生在真的跳出去之后；失败那一路一个字都不许少', () => {
    expect(at("text.value = ''")).toBeGreaterThan(at('uni.navigateTo({ url: target.url })'))
    const failure = sheet.slice(at('catch (err)'), at('finally'))
    expect(failure).not.toContain("text.value = ''")
    // 服务端已经写好了一句话（429、超时、没配密钥），念它，别再说"没看懂"。
    expect(sheet).toContain('err instanceof ApiRequestError ? err.message')
  })

  it('例句点一下是真的发送，不是只填进框', () => {
    // 例句存在的意义是"人不用想词"：点了还要再按一下发送，那就还是要想词。
    expect(sheet).toContain('ASK_EXAMPLES')
    expect(sheet).toMatch(/@click="askWith\(/)
    expect(at('function askWith')).toBeLessThan(at('function send'))
    const askWith = sheet.slice(at('function askWith'), at('async function send'))
    expect(askWith).toContain('send()')
  })

  it('面板是底部弹层，且关闭只改那一个开关', () => {
    expect(sheet).toContain('<u-popup')
    expect(sheet).toContain('mode="bottom"')
    expect(sheet).toContain("emit('update:open', false)")
  })

  it('样式里只认这十六个主题令牌：拼错一个等于那块没有颜色', () => {
    // 深色模式下"没有颜色"是最难被自己发现的一类 bug——浅色看着一切正常。
    const allowed = new Set(Object.keys(toCssVars(lightTokens)))
    const used = sheet.match(/var\(--mb-color-[a-z-]+\)/g) ?? []
    expect(used.length).toBeGreaterThan(0)
    for (const reference of used) {
      const name = reference.slice('var('.length, -1)
      expect(allowed.has(name), `AskSheet.vue 用了不存在的令牌 ${name}`).toBe(true)
    }
  })
})
