import { describe, expect, it } from 'vitest'
import { joinPageUrl } from '../landing-url'

describe('joinPageUrl', () => {
  it('没有配置落地域名时返回空串：邀请页宁可不画二维码', () => {
    expect(joinPageUrl(null, 'ABCD2345')).toBe('')
    expect(joinPageUrl('', 'ABCD2345')).toBe('')
  })

  it('拼出 uni H5 的 hash 路由，而不是一个不存在的路径', () => {
    expect(joinPageUrl('https://example.com', 'ABCD2345')).toBe('https://example.com/#/pages/join/index?code=ABCD2345')
  })

  it('结尾斜杠不去重就会长成 //#/', () => {
    expect(joinPageUrl('https://example.com/', 'ABCD2345')).toBe('https://example.com/#/pages/join/index?code=ABCD2345')
  })

  it('邀请码统一大写：家人手输或截图传来的可能是小写', () => {
    expect(joinPageUrl('https://example.com', 'abcd2345')).toContain('code=ABCD2345')
  })

  it('码里的空格与杂乱字符被去掉，不会拼出一个扫不出的 URL', () => {
    expect(joinPageUrl('https://example.com', ' AB-C D ')).toContain('code=ABCD')
  })
})
