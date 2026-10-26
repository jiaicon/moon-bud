import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 记一笔吃预填这段是 onLoad 里的接线，抽不成纯函数（它改的是三个 ref），
 * 所以和 guest-launch 一样扫源码：这里要钉住的是"顺序"和"脏值不入库"。
 */
const page = readFileSync(join(__dirname, '..', 'event-form', 'index.vue'), 'utf8')

const at = (needle: string): number => {
  const i = page.indexOf(needle)
  expect(i, `源码里没有 ${needle}`).toBeGreaterThan(-1)
  return i
}

describe('记一笔表单的助手预填', () => {
  it('钟点参数格式不对就当没带，不把脏串塞进选择器', () => {
    expect(page).toContain('/^\\d{4}-\\d{2}-\\d{2}$/.test(prefillDate)')
    expect(page).toContain('/^\\d{2}:\\d{2}$/.test(prefillTime)')
    expect(at('/^\\d{4}-\\d{2}-\\d{2}$/.test(prefillDate)')).toBeLessThan(at('date.value = prefillDate'))
    expect(at('/^\\d{2}:\\d{2}$/.test(prefillTime)')).toBeLessThan(at('time.value = prefillTime'))
  })

  it('payload 解析失败不炸页面，只丢预填', () => {
    expect(page).toContain('JSON.parse(rawPayload)')
    const tryAt = at('JSON.parse(rawPayload)')
    expect(page.slice(tryAt - 200, tryAt)).toContain('try {')
    expect(page.slice(tryAt, tryAt + 400)).toContain('catch')
    // 坏 JSON 之后照样要把类型选下去、把界面上的栏摆出来：预填丢了，表单还在。
    expect(at('if (isEventType(requested)) chooseType(requested)')).toBeLessThan(tryAt)
  })

  it('先选类型再回填值：resetForm 会把值清空', () => {
    expect(at('if (isEventType(requested)) chooseType(requested)')).toBeLessThan(
      at('values[field.name] = String(value)'),
    )
  })

  it('数字负载按字符串回填，和手输那一栏同一口径', () => {
    expect(page).toContain('values[field.name] = String(value)')
    // 界面上没有的栏不填：宁可少填，也不给一个看不见却会被提交的值。
    expect(page).toContain('for (const field of fields.value)')
  })

  it('预填不能盖掉用户已经动过的时间：syncWallPrefill 之后再覆盖', () => {
    expect(at('syncWallPrefill()')).toBeLessThan(at('date.value = prefillDate'))
    // 编辑那一路有自己的取值，预填不参与：两条路径不能互相盖。
    expect(at('values[field.name] = String(value)')).toBeGreaterThan(at('if (isEventType(requested))'))
  })
})
