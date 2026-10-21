import { describe, expect, it } from 'vitest'
import { buildRruleFromUi, parseRruleForUi, RRULE_PRESETS } from '../rrule-presets'

describe('rrule 预设', () => {
  it('至少 5 种预设且都有中文标签', () => {
    expect(RRULE_PRESETS.length).toBeGreaterThanOrEqual(5)
    for (const p of RRULE_PRESETS) expect(p.label.length).toBeGreaterThan(0)
  })

  /**
   * 规则里钉死的是周一、是 1 号，chip 却写"同一天"：周五建的人以为每月 15 号，
   * 下面的预览行又写着"每周一 08:00"——同一屏两句话，家长信了错的那句。
   */
  it('预设标签说实话：钉死哪天就说哪天，不许叫"同一天"', () => {
    expect(RRULE_PRESETS.find((p) => p.key === 'weekly')?.label).toBe('每周一')
    expect(RRULE_PRESETS.find((p) => p.key === 'monthly')?.label).toBe('每月 1 日')
  })

  it('buildRruleFromUi 产出合法 rrule 片段', () => {
    expect(buildRruleFromUi({ kind: 'daily', hour: 8, minute: 0 })).toBe('FREQ=DAILY;BYHOUR=08;BYMINUTE=00')
    expect(buildRruleFromUi({ kind: 'everyNDays', hour: 7, minute: 30, n: 2 })).toBe('FREQ=DAILY;INTERVAL=2;BYHOUR=07;BYMINUTE=30')
    expect(buildRruleFromUi({ kind: 'weekly', hour: 9, minute: 0, weekday: 1 })).toBe('FREQ=WEEKLY;BYDAY=TU;BYHOUR=09;BYMINUTE=00')
    expect(buildRruleFromUi({ kind: 'monthly', hour: 20, minute: 15 })).toBe('FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=20;BYMINUTE=15')
  })

  it('补零为两位（rrule 不接受 8:5 这种写法）', () => {
    expect(buildRruleFromUi({ kind: 'daily', hour: 8, minute: 5 })).toContain('BYMINUTE=05')
    expect(buildRruleFromUi({ kind: 'daily', hour: 8, minute: 0 })).toContain('BYHOUR=08')
  })

  it('everyNDays 的 n 至少为 1', () => {
    expect(buildRruleFromUi({ kind: 'everyNDays', hour: 8, minute: 0, n: 0 })).toContain('INTERVAL=1')
  })

  it('每天的预览文案不带时区以外的歧义', () => {
    const daily = RRULE_PRESETS.find((p) => p.key === 'daily')!
    expect(daily.preview('Asia/Shanghai')).toContain('每天')
  })

  it('非法星期取值抛错而不是产出坏 rrule', () => {
    expect(() => buildRruleFromUi({ kind: 'weekly', hour: 8, minute: 0, weekday: 9 })).toThrow()
  })

  it('weekday 以 0 起于周一', () => {
    expect(buildRruleFromUi({ kind: 'weekly', hour: 8, minute: 0, weekday: 0 })).toContain('BYDAY=MO')
    expect(buildRruleFromUi({ kind: 'weekly', hour: 8, minute: 0, weekday: 6 })).toContain('BYDAY=SU')
  })

  it('编辑重复提醒时把 rrule 读回表单，保存不会把时间改成"现在"', () => {
    expect(parseRruleForUi('FREQ=DAILY;BYHOUR=08;BYMINUTE=41')).toMatchObject({
      key: 'daily',
      kind: 'daily',
      hour: 8,
      minute: 41,
    })
    expect(parseRruleForUi('FREQ=DAILY;INTERVAL=3;BYHOUR=20;BYMINUTE=05')).toMatchObject({
      key: 'custom',
      kind: 'everyNDays',
      n: 3,
      hour: 20,
      minute: 5,
    })
    expect(parseRruleForUi('FREQ=WEEKLY;BYDAY=WE;BYHOUR=07;BYMINUTE=30')).toMatchObject({
      key: 'weekly',
      kind: 'weekly',
      weekday: 2,
      hour: 7,
      minute: 30,
    })
    expect(parseRruleForUi('FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=09;BYMINUTE=00')).toMatchObject({
      key: 'monthly',
      kind: 'monthly',
      hour: 9,
    })
  })

  it('读不回的空值与不支持的频率返回 null，不返回半个规则', () => {
    expect(parseRruleForUi(null)).toBeNull()
    expect(parseRruleForUi('')).toBeNull()
    expect(parseRruleForUi('FREQ=HOURLY;INTERVAL=6')).toBeNull()
  })
})
