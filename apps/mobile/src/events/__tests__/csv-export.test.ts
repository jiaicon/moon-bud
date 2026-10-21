import { describe, expect, it } from 'vitest'
import type { ChildDto, EventDto } from '@moonbud/shared'
import { exportCsv, csvFileName } from '../csv-export'

// 导出串以 UTF-8 BOM 起头（见下面专门那条用例）。比表头/整值时先剥掉它，
// 免得每个断言都要背一个看不见的字符。
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

function child(id: string, name: string): ChildDto {
  return {
    id,
    familyId: 'f-1',
    name,
    gender: 'UNKNOWN',
    birthday: '2026-01-01',
    avatarUrl: null,
    archivedAt: null,
  }
}

function event(partial: Partial<EventDto> & Pick<EventDto, 'type' | 'occurredAt'>): EventDto {
  return {
    id: 'e-1',
    childId: 'c-1',
    familyId: 'f-1',
    endedAt: null,
    payload: {},
    note: null,
    createdBy: 'u-1',
    createdByNickname: '妈妈',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...partial,
  } as EventDto
}

describe('exportCsv：家庭记录导出成一份能用 Excel 打开的 CSV', () => {
  it('首行是表头，一条记录一行，列依次是 时间/孩子/类型/详情/记录人/备注', () => {
    const csv = stripBom(
      exportCsv(
        [event({ type: 'feeding', occurredAt: '2026-10-20T01:30:00.000Z', payload: { method: 'bottle', amountMl: 120 } })],
        [child('c-1', '小满')],
        'Asia/Shanghai',
      ),
    )
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('时间,孩子,类型,详情,记录人,备注')
    expect(lines[1]).toBe('2026-10-20 09:30,小满,喂奶,奶瓶 120ml,妈妈,')
  })

  it('时间按账号时区，不是设备本地：同一时刻上海比洛杉矶早 15 小时', () => {
    const at = '2026-10-19T01:30:00.000Z'
    const shanghai = stripBom(exportCsv([event({ type: 'sleep', occurredAt: at })], [child('c-1', '小满')], 'Asia/Shanghai'))
    const la = stripBom(exportCsv([event({ type: 'sleep', occurredAt: at })], [child('c-1', '小满')], 'America/Los_Angeles'))
    expect(shanghai.split('\r\n')[1]).toContain('2026-10-19 09:30,')
    expect(la.split('\r\n')[1]).toContain('2026-10-18 18:30,')
  })

  it('孩子对不上号也不留空，宁可写"未知孩子"：空白会让人以为记录本来就没孩子', () => {
    const csv = stripBom(
      exportCsv([event({ type: 'diaper', occurredAt: '2026-10-20T00:00:00.000Z', childId: 'gone' })], [], 'Asia/Shanghai'),
    )
    expect(csv.split('\r\n')[1]).toContain(',未知孩子,')
  })

  it('含逗号、引号、换行的字段用双引号裹起，内部引号翻倍（RFC 4180）', () => {
    const csv = stripBom(
      exportCsv(
        [event({ type: 'milestone', occurredAt: '2026-10-20T00:00:00.000Z', note: '会叫"妈妈"了, 好开心\n全家沸腾', payload: { title: '翻身' } })],
        [child('c-1', '小满')],
        'Asia/Shanghai',
      ),
    )
    const lastLine = csv.split('\r\n').filter(Boolean).pop() ?? ''
    // 备注里那对引号要变成 ""，整字段被引号包住；里面的换行不能把一行劈成两行。
    expect(lastLine).toContain('"会叫""妈妈""了, 好开心')
  })

  /**
   * 备注是自由文本，家长写 "=1+1" 只是随手，Excel 却会当公式执行。
   * 以 = + - @ 开头的格子前置单引号落成文本（OWASP 对 CSV 注入的常规处置）。
   */
  it('公式样子的备注不会被 Excel 执行：前置单引号落成文本', () => {
    const csv = stripBom(
      exportCsv(
        [event({ type: 'diaper', occurredAt: '2026-10-19T01:30:00.000Z', note: '=1+1,2' })],
        [child('c-1', '小雨')],
        'Asia/Shanghai',
      ),
    )
    expect(csv.split('\r\n')[1]).toContain("\"'=1+1,2\"")
  })

  it('空记录也产出表头，不产出空串：打开就是一片空白会被当成坏了', () => {    expect(stripBom(exportCsv([], [], 'Asia/Shanghai'))).toBe('时间,孩子,类型,详情,记录人,备注\r\n')
  })

  it('导出以 UTF-8 BOM 起头：没有它 Excel 会把中文显示成乱码', () => {
    expect(exportCsv([], [], 'Asia/Shanghai').charCodeAt(0)).toBe(0xfeff)
  })
})

describe('csvFileName：文件名要一眼看出是哪段区间', () => {
  it('不带区间就是"全部记录"', () => {
    expect(csvFileName('', new Date('2026-10-20T02:00:00.000Z'), 'Asia/Shanghai')).toBe('月芽-全部记录-20261020.csv')
  })

  it('带区间就把区间写进名字，多个筛项用短横连', () => {
    expect(csvFileName('近 7 天', new Date('2026-10-20T02:00:00.000Z'), 'Asia/Shanghai')).toBe(
      '月芽-近 7 天-20261020.csv',
    )
  })
})
