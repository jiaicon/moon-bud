import { describe, expect, it } from 'vitest'
import { notificationTarget } from '../routing'

/**
 * 通知只有两种来源：到点的提醒实例（带 occurrenceId），和管理员收到的
 * 找回密码请求（不带）。找回请求的正文写着"请在成员列表里为该账号设置
 * 临时密码"，点进去却落在提醒页，等于路标把人往反方向带。
 */
describe('notificationTarget', () => {
  it('到点的提醒落在提醒列表', () => {
    expect(
      notificationTarget({ occurrenceId: 'occ-1', familyId: 'fam-1' }),
    ).toEqual({ kind: 'reminders' })
  })

  it('找回请求落在成员列表，并带上是哪一家的', () => {
    expect(
      notificationTarget({ occurrenceId: null, familyId: 'fam-9' }),
    ).toEqual({ kind: 'members', familyId: 'fam-9' })
  })

  it('请求里没落成家庭（后端留的空串）时不硬切，停在当前这一家', () => {
    expect(
      notificationTarget({ occurrenceId: null, familyId: '' }),
    ).toEqual({ kind: 'members', familyId: null })
  })
})
