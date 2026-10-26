import { describe, expect, it } from 'vitest'
import { isFaithfulRrule } from '@moonbud/shared'
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

  /**
   * 助手侧的 isFaithfulRrule（"界面摆不摆得出来"）和这里的 parse/build 是同一把尺子的两端。
   * 两份判据各写各的迟早漂移，所以钉住不变量：凡是它放行、以及凡是这里读不回原样的，
   * 两边必须给出同一个说法。
   */
  it('shared 放行的规则这里都能读回原样，读不回的 shared 都挡住', () => {
    const samples = [
      'FREQ=DAILY;BYHOUR=08;BYMINUTE=00',
      'FREQ=DAILY;INTERVAL=3;BYHOUR=07;BYMINUTE=30',
      'FREQ=WEEKLY;BYDAY=WE;BYHOUR=20;BYMINUTE=30',
      'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=09;BYMINUTE=00',
      // 助手不补零也过得了那一关，这里同样要读得回来。
      'FREQ=DAILY',
      'FREQ=DAILY;INTERVAL=2',
      'FREQ=WEEKLY;BYDAY=MO',
      'FREQ=MONTHLY;BYMONTHDAY=1',
    ]
    for (const sample of samples) {
      expect(isFaithfulRrule(sample), `${sample} 应当被放行`).toBe(true)
      const parsed = parseRruleForUi(sample)
      expect(parsed, `${sample} 读不回表单`).not.toBeNull()
      if (!parsed) continue
      // 拼回去再读一次，档位、钟点、间隔、星期都不许在往返里变形。
      const rebuilt = parseRruleForUi(buildRruleFromUi(parsed))
      expect(rebuilt, `${sample} 拼回去读不回`).not.toBeNull()
      expect(rebuilt).toEqual(parsed)
    }
  })

  it('shared 挡掉的那几种，正是这里会读成近似的那几种', () => {
    // 'BYDAY=MO,WE' 在这里只认第一个日子：屏幕写"每周一"、服务端周一周三都响。
    expect(isFaithfulRrule('FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=20;BYMINUTE=30')).toBe(false)
    expect(parseRruleForUi('FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=20;BYMINUTE=30')).toMatchObject({
      key: 'weekly',
      weekday: 0,
    })
    // 'BYMONTHDAY=15' 在这里整个被忽略：预设标签却钉死写着"每月 1 日"。
    expect(isFaithfulRrule('FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=08;BYMINUTE=00')).toBe(false)
    expect(parseRruleForUi('FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=08;BYMINUTE=00')).toMatchObject({ key: 'monthly' })
    // 周频带 INTERVAL：这里读成"每周一"，实际每两周。
    expect(isFaithfulRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=08;BYMINUTE=00')).toBe(false)
    expect(parseRruleForUi('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=08;BYMINUTE=00')).toMatchObject({ key: 'weekly' })
  })
})
