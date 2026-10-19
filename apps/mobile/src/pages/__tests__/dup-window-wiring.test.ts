import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const form = readFileSync(join(root, 'pages', 'event-form', 'index.vue'), 'utf8')
const page = readFileSync(join(root, 'pages', 'dup-window-settings', 'index.vue'), 'utf8')
const profile = readFileSync(join(root, 'pages', 'profile', 'index.vue'), 'utf8')
const app = readFileSync(join(root, 'App.vue'), 'utf8')
const routes = readFileSync(join(root, 'pages.json'), 'utf8')

describe('重复提示窗口可调的接线', () => {
  it('事件表单把 store 解析出的窗口传给 shouldWarnDuplicate，而不是让它自取默认', () => {
    expect(form).toMatch(/useDupWindowStore\(\)/)
    // windowFor(类型) 的结果要作为 windowMinutes 传进提示函数
    expect(form).toMatch(/shouldWarnDuplicate\(\{[\s\S]*windowMinutes:[\s\S]*\}\)/)
    expect(form).toMatch(/windowFor\(/)
  })

  it('设置页按类型列出窗口，读写走 store', () => {
    expect(page).toMatch(/useDupWindowStore\(\)/)
    expect(page).toMatch(/windowFor\(/)
    expect(page).toMatch(/\.set\(/)
    // 每个记录类型都要有一行可选
    expect(page).toMatch(/EVENT_TYPES|eventFields|META/)
  })

  it('设置页注册进路由表，"我的"里有入口', () => {
    expect(routes).toContain('pages/dup-window-settings/index')
    expect(profile).toContain('/pages/dup-window-settings/index')
  })

  it('冷启动初始化窗口 store（与主题一样从本地存储恢复）', () => {
    expect(app).toMatch(/useDupWindowStore\(\)\.init\(\)|dupWindowStore\.init\(\)/)
  })
})
