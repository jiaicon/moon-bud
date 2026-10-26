import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(__dirname, '..', 'index.vue'), 'utf8')

/**
 * 首页这一格是源码扫描：脚本没有 @vue/test-utils 可用（同 guest-launch），
 * 而这一页要拦的正是"画在哪一支、发出去之前拦没拦"这类看得见的行为。
 */
function block(startLine: string): string {
  const lines = page.split('\n')
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

describe('首页「说一句话」', () => {
  it('输入条只画在 ready 那一支：游客与没家庭的人看不见', () => {
    const ready = page.indexOf('<template v-else>')
    expect(ready).toBeGreaterThan(-1)
    expect(page.indexOf('class="ask"')).toBeGreaterThan(ready)
    const guest = page.indexOf("view === 'guest'")
    expect(page.slice(guest, page.indexOf('</template>', guest))).not.toContain('class="ask"')
    const create = page.indexOf("view === 'create-family'")
    expect(page.slice(create, page.indexOf('</view>', create))).not.toContain('class="ask"')
  })

  it('提交走 assistantApi.parse，且发送前有 loading 与空串拦截', () => {
    const send = block('async function submitAssistant')
    expect(page).toContain('const asking = ref(false)')
    expect(send).toContain('if (!askText.value.trim() || asking.value) return')
    expect(send).toContain('assistantApi.parse(text)')
    expect(send).toContain('asking.value = true')
    expect(send).toContain('asking.value = false')
  })

  it('intent 不认识时说"这句我没看懂"，并且不跳页', () => {
    const unknown = block("if (target.kind === 'unknown')")
    expect(unknown).toContain('这句我没看懂，手动记一下')
    expect(unknown).not.toContain('navigateTo')
  })

  it('看懂了就跳，并且把话清空', () => {
    const send = block('async function submitAssistant')
    expect(send).toContain('uni.navigateTo({ url: target.url })')
    expect(send).toContain("askText.value = ''")
    // 孩子只取当前那一个：草稿里没有"孩子"这个概念，不替人猜。
    expect(send).toContain('childId: child.value?.id ?? null')
  })

  it('失败说一句手动记，不静默；429 用服务端那句话', () => {
    const failed = block('catch (err)')
    expect(failed).toContain('err instanceof ApiRequestError ? err.message')
    expect(failed).toContain('这句我没看懂，手动记一下')
    expect(failed).toContain('showToast')
  })

  it('被服务端丢掉的字段要说出来，不能让人以为都填上了', () => {
    const send = block('async function submitAssistant')
    expect(send).toContain('result.dropped.length')
    expect(send).toContain('有些字段没填上')
  })

  it('输入条在提醒过期那两块之前：一句话是首页最主动的动作', () => {
    const ask = page.indexOf('class="ask"')
    const overdue = page.indexOf('v-if="overdueCount > 0"')
    expect(ask).toBeLessThan(overdue)
  })
})
