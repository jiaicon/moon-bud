import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')

/**
 * 表单交出去的是"账号时区的墙上钟点"换算出来的时刻。哪个页面忘了接线，
 * 那个页面上的时间就会在跨时区的设备上按设备本地入库——列表随后按账号时区
 * 念它，家长看到的和自己按的对不上，而且编辑一次再存就再漂一格。
 */
describe('写入按账号时区，预填也按账号时区读回来', () => {
  it('提醒表单：一次性提醒按时区换时刻，并把同一个时区一起交出去', () => {
    const source = read('pages/reminder-form/index.vue')
    expect(source).toContain('isoFromWallTime(timezone.value, date.value, time.value)')
    // 只发 dueAt 不发 timezone：PATCH 之后存的还是旧时区，读出来又是另一个钟点。
    expect(source).toContain('isoFromWallTime(timezone.value, date.value, time.value), timezone: timezone.value')
    expect(source).toContain('wallFields(timezone.value, new Date(reminder.dueAt))')
    expect(source, '设备本地的换算法还留着').not.toContain('localIso')
  })

  it('记录表单：起止两个时间都按时区换算，编辑预填也走同一条路', () => {
    const source = read('pages/event-form/index.vue')
    expect(source).toContain('occurredAt: isoFromWallTime(timezone.value, date.value, time.value)')
    expect(source).toContain('isoFromWallTime(timezone.value, endDate.value, endTime.value')
    expect(source).toContain('eventToFormState(target, timezone.value)')
    expect(source, '设备本地的换算法还留着').not.toContain('localIso')
  })

  it('两个表单都在 timezone 定下来之后才预填', () => {
    for (const page of ['pages/reminder-form/index.vue', 'pages/event-form/index.vue']) {
      const source = read(page)
      const declared = source.indexOf('const timezone = computed')
      const prefilled = source.indexOf('wallFields(timezone.value)')
      expect(declared, page).toBeGreaterThan(-1)
      expect(prefilled, `${page} 在用 timezone 之前预填了`).toBeGreaterThan(declared)
    }
  })

  it('两个表单都等会话落定后再补一次预填', () => {
    // 时区是账号属性，而账号要冷启动的静默登录才有。浏览器实测过：直开深链接时
    // setup 里的预填用的是兜底时区，填出来的钟点和账号所在处差了 15 小时。
    for (const page of ['pages/reminder-form/index.vue', 'pages/event-form/index.vue']) {
      const source = read(page)
      const settled = source.indexOf('if (!authStore.user) await authStore.bootstrap()')
      // 从"会话落定"往后找调用点：函数声明本身写在前面，不算数。
      const reprefill = source.indexOf('syncWallPrefill()', settled + 1)
      expect(settled, `${page} 没等会话落定`).toBeGreaterThan(-1)
      expect(reprefill, `${page} 在会话落定后没有重新预填`).toBeGreaterThan(settled)
    }
  })
})
