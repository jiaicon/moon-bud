import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NotificationDto } from '@moonbud/shared'
import type { QuickRecordPlan } from '../quick-record'

const markReadMock = vi.hoisted(() => vi.fn())
const submitCreateMock = vi.hoisted(() => vi.fn())
const refreshBadgeMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/endpoints', () => ({ notificationsApi: { markRead: markReadMock } }))
vi.mock('../../stores/outbox', () => ({ useOutboxStore: () => ({ submitCreate: submitCreateMock }) }))
vi.mock('../tab-badge', () => ({ refreshUnreadTabBadge: refreshBadgeMock }))

const { quickRecordPlan, submitQuickRecord } = await import('../quick-record')

const NOW = new Date('2026-10-23T01:00:00.000Z')

function notice(action: NotificationDto['action'], familyId = 'f-1'): NotificationDto {
  return {
    id: 'n-1',
    userId: 'u-1',
    familyId,
    occurrenceId: 'o-1',
    title: '吃维D',
    body: '',
    readAt: null,
    createdAt: '2026-10-23T00:00:00.000Z',
    action,
  }
}

const action = {
  reminderId: 'r-1',
  childId: 'c-1',
  eventType: 'medicine' as const,
  payload: { name: '维D', dose: '400IU' },
}

describe('quickRecordPlan：这条通知给哪个动作', () => {
  it('没有动作的通知不给动作入口', () => {
    expect(quickRecordPlan(notice(null), NOW)).toEqual({ kind: 'none' })
  })

  it('预填合法：按钮叫"记一笔"，写库入参用当前时刻和这条提醒的出处', () => {
    const plan = quickRecordPlan(notice(action), NOW)
    expect(plan.kind).toBe('record')
    expect((plan as { kind: 'record'; label: string }).label).toBe('记一笔')
    expect((plan as { familyId: string }).familyId).toBe('f-1')
    expect((plan as { input: unknown }).input).toEqual({
      childId: 'c-1',
      type: 'medicine',
      occurredAt: NOW.toISOString(),
      payload: { name: '维D', dose: '400IU' },
      fromReminderId: 'r-1',
      note: null,
    })
  })

  it('occurredAt 是当前时刻，不是通知的 createdAt', () => {
    // createdAt 故意与 NOW 差一小时：记的是"我现在补的这一笔"，不是"通知生成的那一刻"。
    const item = { ...notice(action), createdAt: '2026-10-22T23:00:00.000Z' }
    const plan = quickRecordPlan(item, NOW)
    expect((plan as { input: { occurredAt: string } }).input.occurredAt).toBe(NOW.toISOString())
  })

  it('跳表单把这一家、这个孩子、这条提醒都带上：只带类型会让人记到别的孩子身上', () => {
    const plan = quickRecordPlan(notice({ ...action, payload: null }, 'f-9'), NOW)
    expect(plan).toEqual({
      kind: 'form',
      label: '去记一笔',
      url: '/pages/event-form/index?type=medicine&childId=c-1&familyId=f-9&reminderId=r-1',
    })
  })

  it('服务端说 payload 为 null 就跳表单 —— 归档孩子那一条也走这里，客户端不自己判', () => {
    // 归档由服务端在 action.payload 上置空（notifications.service）：客户端的孩子列表
    // 接口本来就不返回归档孩子（children.service 过滤 archivedAt），它没有判的资格。
    expect(quickRecordPlan(notice({ ...action, payload: null }), NOW).kind).toBe('form')
    const source = readFileSync(join(__dirname, '..', 'quick-record.ts'), 'utf8')
    expect(source).not.toMatch(/archivedAt/)
    expect(source).not.toMatch(/stores\/child/)
  })

  it('familyId 用通知自己的，不用当前选中的家庭', () => {
    const plan = quickRecordPlan(notice(action, 'f-other'), NOW)
    expect((plan as { familyId: string }).familyId).toBe('f-other')
    // 源码扫描：这一路压根不读当前家庭，切家庭是另一件事。
    const source = readFileSync(join(__dirname, '..', 'quick-record.ts'), 'utf8')
    expect(source).not.toMatch(/currentFamilyId/)
  })
})

describe('submitQuickRecord：写完就把这条通知收掉', () => {
  beforeEach(() => {
    markReadMock.mockReset()
    submitCreateMock.mockReset()
    refreshBadgeMock.mockReset()
  })

  const plan: Extract<QuickRecordPlan, { kind: 'record' }> = {
    kind: 'record',
    label: '记一笔',
    familyId: 'f-1',
    input: {
      childId: 'c-1',
      type: 'medicine',
      occurredAt: NOW.toISOString(),
      payload: { name: '维D', dose: '400IU' },
      fromReminderId: 'r-1',
      note: null,
    },
  }

  it('在线写完就标已读并刷角标', async () => {
    submitCreateMock.mockResolvedValue({ kind: 'saved', event: { id: 'e-1' } })
    markReadMock.mockResolvedValue(notice(action))
    const res = await submitQuickRecord(plan, 'n-1')
    expect(res).toBe('saved')
    expect(submitCreateMock).toHaveBeenCalledWith('f-1', plan.input)
    expect(markReadMock).toHaveBeenCalledWith('n-1')
    expect(refreshBadgeMock).toHaveBeenCalled()
  })

  it('断网排队也算这次点成功：同样标已读、同样刷角标', async () => {
    submitCreateMock.mockResolvedValue({ kind: 'queued', clientEventId: 'x-1' })
    markReadMock.mockResolvedValue(notice(action))
    expect(await submitQuickRecord(plan, 'n-1')).toBe('queued')
    expect(markReadMock).toHaveBeenCalledWith('n-1')
    expect(refreshBadgeMock).toHaveBeenCalled()
  })

  it('标已读失败不拦人：写库已经成功了，这里只留一行日志', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    submitCreateMock.mockResolvedValue({ kind: 'saved', event: { id: 'e-1' } })
    markReadMock.mockRejectedValue(new Error('离线'))
    await expect(submitQuickRecord(plan, 'n-1')).resolves.toBe('saved')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('写库排队之外的真错误要原样抛出去，不能假装记上了', async () => {
    submitCreateMock.mockRejectedValue(new Error('没有权限这样做'))
    await expect(submitQuickRecord(plan, 'n-1')).rejects.toThrow('没有权限这样做')
    expect(markReadMock).not.toHaveBeenCalled()
  })
})
