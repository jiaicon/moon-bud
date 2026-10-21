import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATE_ENTRY_PATHS, LOGIN_ENTRY_URL, PUBLIC_ENTRY, TEACH_PATH, needsLogin } from '../gate'

const gateSource = readFileSync(join(__dirname, '..', 'gate.ts'), 'utf8')

describe('游客在"我的"点一行之后', () => {
  it('教学与主题两行免登录：它们要的是这台手机，不是账号', () => {
    for (const entry of PUBLIC_ENTRY) {
      expect(needsLogin(entry, true), entry).toBe(false)
    }
  })

  it('其余每一行在游客身上都不许真的进去', () => {
    for (const entry of GATE_ENTRY_PATHS) {
      expect(needsLogin(entry, true), entry).toBe(true)
    }
  })

  it('没登记在册的页面默认也不许进：漏登记比多写一行白名单贵', () => {
    expect(needsLogin('/pages/unknown/index', true)).toBe(true)
  })

  it('登录了就不拦路，白名单内外一律放行', () => {
    for (const entry of [...GATE_ENTRY_PATHS, ...PUBLIC_ENTRY]) {
      expect(needsLogin(entry, false), entry).toBe(false)
    }
  })

  it('教学那一行的路由就是预览页本尊', () => {
    expect(TEACH_PATH).toBe('/pages/preview/index')
    expect(PUBLIC_ENTRY).toContain(TEACH_PATH)
  })
})

/**
 * 2026-10-21 改了规矩：游客点要账号的东西一律无反应，不再弹"需要登录吗"。
 * 这一格挡的是那份文案被留在原地——没人调用 yet 每个读代码的人都以为弹窗还在。
 */
describe('登录引导弹窗已经从门禁里删干净', () => {
  it('gate.ts 不再问"要不要去登录"，只回答"这一行要不要账号"', () => {
    expect(gateSource).not.toContain('confirmLoginGate')
    expect(gateSource).not.toMatch(/from '\.\.\/utils\/confirm'/)
    expect(gateSource).not.toMatch(/LOGIN_GATE_(TITLE|CONFIRM|CANCEL)/)
  })

  it("游客要登录只剩一条明路：底部那颗按钮，落在注册那一挡", () => {
    expect(LOGIN_ENTRY_URL).toContain('mode=register')
  })
})
