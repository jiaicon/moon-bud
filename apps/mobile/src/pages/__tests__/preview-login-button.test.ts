import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'preview/index.vue'), 'utf8')

function rule(cls: string): string {
  const at = src.indexOf(`\n${cls} {`)
  expect(at, `${cls} 的样式不在了`).toBeGreaterThan(-1)
  return src.slice(at, src.indexOf('}', at))
}

/**
 * 顶部那一行是"标题 + 注册/登录"两颗。中文哪里都能断行，于是长标题一挤，
 * 那颗药丸自己先折成三行、圆角被撑变形。宽度该让给按钮，让标题去换行。
 */
describe('预览页的注册/登录按钮不许被挤变形', () => {
  it('按钮不参与收缩，文字也不折行', () => {
    expect(rule('.preview__login')).toContain('flex-shrink: 0')
    expect(rule('.preview__login-label')).toContain('white-space: nowrap')
  })

  it('收缩让给左边那叠字：它才是要换行的那一个', () => {
    expect(rule('.preview__heading')).toContain('min-width: 0')
  })
})
