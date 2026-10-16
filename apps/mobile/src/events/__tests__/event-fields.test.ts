import { describe, expect, it } from 'vitest'
import { EVENT_TYPES } from '@moonbud/shared'
import { EVENT_TYPE_META, fieldsFor, requiredFieldCount } from '../event-fields'

describe('记录表单字段', () => {
  it('8 种类型都有元数据与字段定义', () => {
    expect(EVENT_TYPES).toHaveLength(8)
    for (const t of EVENT_TYPES) {
      expect(EVENT_TYPE_META[t]).toBeTruthy()
      expect(fieldsFor(t).length).toBeGreaterThan(0)
    }
  })

  it('每种类型的必填字段不超过 2 个 —— 单手抱娃时必须能填完', () => {
    for (const t of EVENT_TYPES) {
      expect(requiredFieldCount(t), `${t} 的必填项过多`).toBeLessThanOrEqual(2)
    }
  })

  it('每个必填字段都在字段列表里，且没有孤立的必填声明', () => {
    for (const t of EVENT_TYPES) {
      const specNames = fieldsFor(t).map((f) => f.name)
      for (const required of EVENT_TYPE_META[t].requiredFields) {
        expect(specNames, `${t}.${required} 不在字段列表`).toContain(required)
      }
    }
  })

  it('必填字段与 shared 的 schema 一致（喂奶 method、体温 celsius、大小便 kind）', () => {
    expect(EVENT_TYPE_META.feeding.requiredFields).toEqual(['method'])
    expect(EVENT_TYPE_META.temperature.requiredFields).toEqual(['celsius'])
    expect(EVENT_TYPE_META.diaper.requiredFields).toEqual(['kind'])
    expect(EVENT_TYPE_META.solid.requiredFields).toEqual(['food'])
    expect(EVENT_TYPE_META.medicine.requiredFields).toEqual(['name', 'dose'])
    expect(EVENT_TYPE_META.milestone.requiredFields).toEqual(['title'])
  })

  it('体温字段带摄氏度单位与合理范围提示', () => {
    const f = fieldsFor('temperature').find((x) => x.name === 'celsius')!
    expect(f.unit).toBe('℃')
    expect(f.kind).toBe('number')
  })

  it('防重复窗口按类型区分，喂奶短于用药', () => {
    expect(EVENT_TYPE_META.feeding.duplicateWindowMinutes).toBeLessThan(
      EVENT_TYPE_META.medicine.duplicateWindowMinutes,
    )
  })
})
