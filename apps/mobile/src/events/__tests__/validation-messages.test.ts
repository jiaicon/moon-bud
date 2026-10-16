import { describe, expect, it } from 'vitest'
import { zhValidationMessage } from '../validation-messages'

describe('校验文案中文化', () => {
  it('已经是中文的原样返回（shared 的 refine 文案本来就是中文）', () => {
    expect(zhValidationMessage('体重、身高、头围至少填一项')).toBe('体重、身高、头围至少填一项')
  })

  it('把 zod 的英文上下限翻成中文，数字保留', () => {
    expect(zhValidationMessage('Number must be less than or equal to 45')).toBe('不能大于 45')
    expect(zhValidationMessage('Number must be greater than or equal to 30')).toBe('不能小于 30')
    expect(zhValidationMessage('Number must be greater than 0')).toBe('必须大于 0')
    expect(zhValidationMessage('Number must be less than 2000')).toBe('必须小于 2000')
  })

  it('整数、空串与未知形状都有可读中文，绝不把英文甩给家长', () => {
    expect(zhValidationMessage('Number must be an integer')).toBe('请填写整数')
    expect(zhValidationMessage('String must contain at least 1 character(s)')).toBe('不能为空')
    expect(zhValidationMessage('Required')).toBe('请填写')
    expect(zhValidationMessage('somehow weird')).toBe('格式不正确')
  })
})
