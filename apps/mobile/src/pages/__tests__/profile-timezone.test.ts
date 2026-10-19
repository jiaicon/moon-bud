import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'profile/index.vue'), 'utf8')

/**
 * 注册时 timezone 取自设备、看不见也改不了，而全屏的日期与钟点都按它念。
 * 这一页必须给出一个改的入口，并且改完显示的还是服务端返回的那个值。
 */
describe('我的页可以改账号时区', () => {
  it('用选择器列出候选，并把当前值作为选中项', () => {
    expect(src).toMatch(/:range="timezoneOptions"/)
    expect(src).toMatch(/range-key="name"/)
    expect(src).toMatch(/:value="timezoneIndex"/)
  })

  it('念的是账号时区本身，不是又复制一份本地状态', () => {
    expect(src).toMatch(/const user = computed\(\(\) => authStore\.user\)/)
    expect(src).toMatch(/timezoneLabel\(user\.value\.timezone\)/)
    expect(src).not.toMatch(/const timezone = ref\(/)
  })

  it('提交走 store，失败时把原因说出来而不是静留在原值上', () => {
    expect(src).toMatch(/await authStore\.updateTimezone\(option\.zone\)/)
    expect(src).toMatch(/uni\.showToast\(\{ title: ok \?/)
  })

  it('说清楚改的是"怎么看"，不是"已经记下了什么"', () => {
    expect(src).toMatch(/已记下的时刻不变/)
  })
})
