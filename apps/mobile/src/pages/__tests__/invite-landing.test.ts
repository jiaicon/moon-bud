import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 两条终审遗留（I-13 / I-14）都是"页面没了/颜色跟着主题跑了"这种一改就忘的约束，
 * 只能靠读源码钉住：单元测试跑不到真机的微信扫码器。
 */
const srcDir = join(__dirname, '..', '..')
const invitePage = readFileSync(join(srcDir, 'pages', 'invite-qrcode', 'index.vue'), 'utf8')
const pagesJson = readFileSync(join(srcDir, 'pages.json'), 'utf8')

describe('邀请二维码', () => {
  it('码点固定黑码白底，不吃主题令牌', () => {
    const dark = /\.qr__cell--dark\s*\{([^}]*)\}/.exec(invitePage)?.[1] ?? ''
    const light = /\.qr__cell--light\s*\{([^}]*)\}/.exec(invitePage)?.[1] ?? ''
    expect(dark).toMatch(/#000000/i)
    expect(light).toMatch(/#ffffff/i)
    expect(dark + light).not.toContain('--mb-color')
  })

  it('落地地址走 joinPageUrl，不再是手拼的 /join?code=', () => {
    expect(invitePage).toContain('joinPageUrl')
    expect(invitePage).not.toMatch(/INVITE_LANDING_BASE_URL\}\//)
  })
})

describe('扫码落地页', () => {
  it('pages.json 里注册了 pages/join/index', () => {
    expect(pagesJson.replace(/\/\/[^\n]*/g, '')).toContain('"pages/join/index"')
  })

  it('落地页在没有会话时把人交给登录页，而不是白屏', () => {
    const joinPage = readFileSync(join(srcDir, 'pages', 'join', 'index.vue'), 'utf8')
    expect(joinPage).toContain('/pages/login/index?mode=join&code=')
  })
})
