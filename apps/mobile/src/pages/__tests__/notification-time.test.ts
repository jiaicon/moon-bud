import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages/notification-center/index.vue'), 'utf8')

/**
 * 通知列表里"提醒在 08:00 触发"和这条通知是几点发的，必须按家人那块表念。
 * 同一屏上提醒卡片的时间已经按账号时区显示，通知却按设备本地格式化：
 * 人在北京的洛杉矶账号会看到"妈妈 16:00 发了通知"，而她的家庭里是 01:00。
 */
describe('通知中心按账号时区念时刻', () => {
  it('不再用设备本地方法格式化时间', () => {
    expect(src).not.toMatch(/getMonth\(\)|getHours\(\)/)
  })

  it('用账号时区把时刻拆成显示用的年月日与钟点', () => {
    expect(src).toMatch(/const timezone = computed\(\(\) => authStore\.user\?\.timezone \?\? 'Asia\/Shanghai'\)/)
    expect(src).toMatch(/wallStamp\(timezone\.value/)
  })

  it('先等冷启动的静默登录落定，否则第一屏用的是兜底时区', () => {
    // 只看 onLoad 那一段：readAll 里也有一句 await load(true)，全文取第一次出现会误判。
    const onLoad = src.indexOf('onLoad(async () => {')
    expect(onLoad).toBeGreaterThan(-1)
    const body = src.slice(onLoad, src.indexOf('})', onLoad))
    const settled = body.indexOf('if (!authStore.user) await authStore.bootstrap()')
    const loaded = body.indexOf('await load(true)')
    expect(settled).toBeGreaterThan(-1)
    expect(loaded).toBeGreaterThan(-1)
    expect(settled, '等会话之前先拉列表，第一屏就按错误的时区念').toBeLessThan(loaded)
  })
})
