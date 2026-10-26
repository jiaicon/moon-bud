import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 记一笔吃预填这段是 onLoad 里的接线，抽不成纯函数（它改的是三个 ref），
 * 所以和 guest-launch 一样扫源码：这里要钉住的是"顺序"、"脏值不入库"和"草稿不走 url"。
 */
const page = readFileSync(join(__dirname, '..', 'event-form', 'index.vue'), 'utf8')

const at = (needle: string): number => {
  const i = page.indexOf(needle)
  expect(i, `源码里没有 ${needle}`).toBeGreaterThan(-1)
  return i
}

describe('记一笔表单的助手预填', () => {
  it('草稿从本地交接取，url 上不留任何助手参数（App 会把 query 再编码一遍）', () => {
    expect(page).toContain('takeEventDraft()')
    // 通知那一路的 familyId/childId/reminderId 仍走 url（都是 ASCII 的 id，不经编码这一层）。
    expect(page).not.toContain('query?.payload')
    expect(page).not.toContain('query?.date')
    expect(page).not.toContain('query?.time')
  })

  it('钟点格式不对就当没带，不把脏串塞进选择器', () => {
    expect(page).toContain('/^\\d{4}-\\d{2}-\\d{2}$/.test(prefillDate)')
    expect(page).toContain('/^\\d{2}:\\d{2}$/.test(prefillTime)')
    expect(at('/^\\d{4}-\\d{2}-\\d{2}$/.test(prefillDate)')).toBeLessThan(at('date.value = prefillDate'))
    expect(at('/^\\d{2}:\\d{2}$/.test(prefillTime)')).toBeLessThan(at('time.value = prefillTime'))
  })

  it('编辑那一路不取草稿：一次编辑不该把助手那句话白白烧掉', () => {
    // 编辑分支自己 return，取用点必须在它之后。
    expect(at('const asked = takeEventDraft()')).toBeGreaterThan(at('const target = takeForEdit(id)'))
    expect(at('const asked = takeEventDraft()')).toBeGreaterThan(at('endTime.value = state.endTime'))
  })

  it('先定类型再回填值：resetForm 会把值清空', () => {
    expect(at('if (isEventType(nextType)) chooseType(nextType)')).toBeLessThan(
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
  })

  it('草稿带来的孩子要落进这一笔：不认当前选中的那个，否则会记到别人家孩子身上', () => {
    expect(page).toContain('if (asked?.childId) targetChildId.value = asked.childId')
    // 而且要在选类型之前：防重复提示按"这一笔真正落到的孩子"查。
    expect(at('targetChildId.value = asked.childId')).toBeLessThan(at('chooseType(nextType)'))
  })
})
