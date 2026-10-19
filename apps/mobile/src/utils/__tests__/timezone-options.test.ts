import { describe, expect, it } from 'vitest'
import {
  TIMEZONE_OPTIONS,
  pickerOptions,
  timezoneLabel,
  utcOffsetLabel,
  zoneOffsetMinutes,
} from '../timezone-options'

// 固定在一个北美还在夏令时、中国常年 +8 的瞬间，免得断言跟着日历变。
const OCT = new Date('2026-10-19T06:00:00.000Z')
const JAN = new Date('2026-01-19T06:00:00.000Z')

describe('zoneOffsetMinutes', () => {
  it('给出目标时区相对 UTC 的分钟数', () => {
    expect(zoneOffsetMinutes('Asia/Shanghai', OCT)).toBe(480)
    expect(zoneOffsetMinutes('Asia/Kolkata', OCT)).toBe(330)
    expect(zoneOffsetMinutes('Pacific/Kiritimati', OCT)).toBe(840)
  })

  it('夏令时跟着日历走：洛杉矶十月 -7、一月 -8', () => {
    expect(zoneOffsetMinutes('America/Los_Angeles', OCT)).toBe(-420)
    expect(zoneOffsetMinutes('America/Los_Angeles', JAN)).toBe(-480)
  })

  it('时区名不可用时返回 null，不抛错', () => {
    expect(zoneOffsetMinutes('Mars/Olympus', OCT)).toBeNull()
    expect(zoneOffsetMinutes('', OCT)).toBeNull()
  })
})

describe('utcOffsetLabel', () => {
  it('整小时不补零头的分钟', () => {
    expect(utcOffsetLabel('Asia/Shanghai', OCT)).toBe('UTC+8')
    expect(utcOffsetLabel('America/Los_Angeles', OCT)).toBe('UTC-7')
    expect(utcOffsetLabel('UTC', OCT)).toBe('UTC+0')
  })

  it('半小时与四十五分钟把分钟写出来', () => {
    expect(utcOffsetLabel('Asia/Kolkata', OCT)).toBe('UTC+5:30')
    expect(utcOffsetLabel('Asia/Kathmandu', OCT)).toBe('UTC+5:45')
  })

  it('认不出的时区没有偏移可报，返回空串', () => {
    expect(utcOffsetLabel('Mars/Olympus', OCT)).toBe('')
  })
})

describe('timezoneLabel', () => {
  it('清单内的时区报地名与偏移', () => {
    expect(timezoneLabel('Asia/Shanghai', OCT)).toBe('上海（UTC+8）')
  })

  it('清单外的合法时区不编地名，报原名加偏移', () => {
    expect(timezoneLabel('Pacific/Niue', OCT)).toBe('Pacific/Niue（UTC-11）')
  })

  it('不可用的时区名原样退回，不谎称一个偏移', () => {
    expect(timezoneLabel('Mars/Olympus', OCT)).toBe('Mars/Olympus')
  })
})

describe('pickerOptions', () => {
  it('当前时区不在清单里时排在最前：选择器不能把一个没在列表里的值显示成第一项', () => {
    const options = pickerOptions('Pacific/Niue')
    expect(options[0].zone).toBe('Pacific/Niue')
    expect(options.filter((o) => o.zone === 'Pacific/Niue')).toHaveLength(1)
  })

  it('当前时区已在清单里时不重复', () => {
    const options = pickerOptions('Asia/Shanghai')
    expect(options.filter((o) => o.zone === 'Asia/Shanghai')).toHaveLength(1)
    expect(options.map((o) => o.zone)).toEqual(TIMEZONE_OPTIONS.map((o) => o.zone))
  })
})
