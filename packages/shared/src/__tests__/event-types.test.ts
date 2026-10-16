import { describe, expect, it } from 'vitest'
import { EVENT_TYPES, NOTE_MAX_LENGTH, validateEventPayload, validateNote } from '../event-types'

describe('validateEventPayload', () => {
  it('接受合法的喂奶记录', () => {
    const r = validateEventPayload('feeding', { method: 'bottle', amountMl: 120 })
    expect(r.ok).toBe(true)
  })

  it('拒绝喂奶 method 取值之外的值', () => {
    const r = validateEventPayload('feeding', { method: 'telepathy' })
    expect(r.ok).toBe(false)
  })

  it('拒绝多带的未知字段', () => {
    const r = validateEventPayload('feeding', { method: 'bottle', amountMl: 120, bogus: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/bogus|unrecognized/i)
  })

  it('拒绝非正数的奶量', () => {
    expect(validateEventPayload('feeding', { method: 'bottle', amountMl: 0 }).ok).toBe(false)
    expect(validateEventPayload('feeding', { method: 'bottle', amountMl: -30 }).ok).toBe(false)
  })

  it('用人体体温范围拦住华氏度输入', () => {
    expect(validateEventPayload('temperature', { celsius: 36.8 }).ok).toBe(true)
    expect(validateEventPayload('temperature', { celsius: 98.6 }).ok).toBe(false)
    expect(validateEventPayload('temperature', { celsius: 29 }).ok).toBe(false)
    expect(validateEventPayload('temperature', { celsius: 46 }).ok).toBe(false)
  })

  it('拒绝睡眠 quality 取值之外的值', () => {
    expect(validateEventPayload('sleep', { quality: 'good' }).ok).toBe(true)
    expect(validateEventPayload('sleep', { quality: 'excellent' }).ok).toBe(false)
  })

  it('接受只有必填项的里程碑', () => {
    expect(validateEventPayload('milestone', { title: '第一次翻身' }).ok).toBe(true)
    expect(validateEventPayload('milestone', {}).ok).toBe(false)
  })

  it('拒绝未知的记录类型', () => {
    // @ts-expect-error 故意传非法类型
    expect(validateEventPayload('nonsense', {}).ok).toBe(false)
  })

  it('暴露 8 种记录类型且 note 上限为 500', () => {
    expect(EVENT_TYPES).toHaveLength(8)
    expect(NOTE_MAX_LENGTH).toBe(500)
  })

  it('growth 要求体重/身高/头围至少一项', () => {
    expect(validateEventPayload('growth', {}).ok).toBe(false)
    expect(validateEventPayload('growth', { weightKg: 7.2 }).ok).toBe(true)
  })

  it('note 超长时 validateNote 返回错误', () => {
    expect(validateNote('x'.repeat(501))?.ok).toBe(false)
    expect(validateNote('短备注')).toBeNull()
    expect(validateNote(undefined)).toBeNull()
  })
})
