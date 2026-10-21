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

/**
 * 这一页现在是"我的"里的功能教学，登录的人也会点进来。给还没账号的人准备的那两格
 * 出口（顶上的注册/登录、底下那颗"开始使用"送去注册页）对着他已经登录的人来说是谎话。
 */
describe('教学页的出口按身份分岔', () => {
  it('已登录就不画顶上那格"注册 / 登录"', () => {
    expect(src).toMatch(/const loggedIn = computed\(\(\) => authStore\.session === 'member'\)/)
    expect(src).toMatch(/<view v-if="!loggedIn" class="preview__login"/)
  })

  it('底下一颗"开始使用"照旧在，只是落点跟着身份换', () => {
    expect(src).toMatch(/@click="start"/)
    const body = src.slice(src.indexOf('function start()'))
    // 已登录的人要的是回到应用里；首页是 tabBar 页，navigateTo 进不去，只能 switchTab。
    expect(body).toMatch(/uni\.switchTab\(\{ url: '\/pages\/home\/index' \}\)/)
    expect(body).toMatch(/uni\.navigateTo\(\{ url: LOGIN_ENTRY_URL \}\)/)
    expect(src).not.toMatch(/navigateTo\(\{ url: '\/pages\/home\/index' \}/)
  })
})
