import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')

/** 取一个函数从签名到下一个顶格 `}` 的正文。 */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`找不到 ${signature}`)
  const end = source.indexOf('\n}', start)
  return source.slice(start, end < 0 ? undefined : end)
}

/**
 * 分段/筛选一变色，界面上写的是新条件，列表里还是旧条件的数据 ——
 * 因为那次刷新被"正在加载"挡掉了。挡掉不是保护，是把不一致留在了屏幕上。
 */
describe('列表刷新排队而不是被挡掉', () => {
  const pages: [string, string][] = [
    ['提醒列表', 'pages/reminder-list/index.vue'],
    ['提醒中心', 'pages/notification-center/index.vue'],
  ]

  for (const [name, file] of pages) {
    it(`${name} 用队列串行，后一次一定真跑`, () => {
      const source = read(file)
      expect(source).toContain('let queue: Promise<void> = Promise.resolve()')
      expect(source).toMatch(/queue\.then\(\(\) => run/)
      expect(source, `${name} 还在用 loading 挡掉后来的刷新`).not.toMatch(/if \(loading\.value\) return/)
      expect(source, `${name} 还在用 loading 挡掉后来的刷新`).not.toMatch(/\|\| loading\.value/)
    })
  }

  it('全部已读之后未读数重新取，不会停在旧数字', () => {
    const body = bodyOf(read('pages/notification-center/index.vue'), 'async function readAll')
    expect(body, '读完还挂着"N 条未读"').toContain('await load(true)')
  })
})
