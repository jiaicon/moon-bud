import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lightTokens } from '../../theme/tokens'
import { toCssVars } from '../../theme/presets'

/**
 * 表单顶部那一条横幅是唯一一处"助手当着人的面说话"的地方：它要说清楚这份草稿是
 * 从一句话来的，还要在有的字段没填上时说实话。所以钉的是"什么条件下才开口"。
 */
const forms = [
  { page: 'event-form', take: 'const asked = takeEventDraft()', editGuard: 'if (id) {' },
  { page: 'reminder-form', take: 'const asked = id ? null : takeReminderDraft()', editGuard: '' },
] as const

function source(page: string): string {
  return readFileSync(join(__dirname, '..', page, 'index.vue'), 'utf8')
}

function block(src: string, startLine: string): string {
  const lines = src.split('\n')
  const from = lines.findIndex((line) => line.includes(startLine))
  expect(from, `找不到 ${startLine}`).toBeGreaterThan(-1)
  let depth = 0
  let opened = false
  let out = ''
  for (let i = from; i < lines.length; i++) {
    out += lines[i] + '\n'
    depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length
    if (depth > 0) opened = true
    else if (i > from && opened) break
  }
  return out
}

describe('表单顶部的"助手填好了"横幅', () => {
  for (const { page, take, editGuard } of forms) {
    it(`${page}：那句话只来自 ask-flow 这一个来源`, () => {
      const src = source(page)
      expect(src).toContain("import { askBannerCopy } from '../../assistant/ask-flow'")
      expect(src).toContain('askBanner.value = askBannerCopy(asked.dropped)')
      // 页面自己再写一遍文案，两处就会各自漂。
      expect(src).not.toContain('填好了')
    })

    it(`${page}：只有真取到了草稿才开口`, () => {
      const asked = block(source(page), 'if (asked) {')
      expect(asked).toContain('askBanner.value = askBannerCopy(asked.dropped)')
      expect(source(page)).toContain(take)
    })

    it(`${page}：编辑那一路不挂横幅——人这次没说话`, () => {
      const src = source(page)
      if (editGuard) {
        expect(block(src, editGuard)).not.toContain('askBanner')
      } else {
        // 这一页的闸门是那个三元：带着 id 就根本不取草稿，asked 恒为 null。
        expect(src).toContain('const asked = id ? null : takeReminderDraft()')
      }
    })

    it(`${page}：横幅只用这十六个主题令牌，且文案是绑上去的`, () => {
      const src = source(page)
      expect(src).toContain('class="ask-banner"')
      expect(src).toContain('{{ askBanner }}')
      const allowed = new Set(Object.keys(toCssVars(lightTokens)))
      const used = src.match(/var\(--mb-color-[a-z-]+\)/g) ?? []
      expect(used.length).toBeGreaterThan(0)
      for (const reference of used) {
        const name = reference.slice('var('.length, -1)
        expect(allowed.has(name), `${page} 用了不存在的令牌 ${name}`).toBe(true)
      }
    })
  }
})
