import { createHash } from 'node:crypto'
import {
  GETUI_BASE,
  buildAuthBody,
  buildPushBody,
} from '../src/push/getui/getui-request'

describe('个推鉴权请求体', () => {
  it('sign 是 appKey+masterSecret+timestamp 的 sha256，另外两个字段原样', () => {
    const body = buildAuthBody('k', 'm', '1700000000000')

    expect(body.sign).toBe(
      createHash('sha256').update('k' + 'm' + '1700000000000').digest('hex'),
    )
    expect(body.appKey).toBe('k')
    expect(body.timestamp).toBe('1700000000000')
  })

  it('地址按 appId 拼，不含多余斜杠', () => {
    expect(GETUI_BASE('AppID123')).toBe('https://restapi.getui.com/v2/AppID123')
  })
})

describe('个推推送请求体', () => {
  const base = {
    cids: ['a', 'b'],
    title: '有人需要重置密码',
    body: 'x 提交了请求',
    ttlMs: 3_600_000,
    requestId: 'r1',
    data: { familyId: 'f1' },
  }

  it('cid 列表、ttl、系统消息分级与透传 payload 各归其位', () => {
    const body = buildPushBody(base)

    expect(body.audience).toEqual({ cid: ['a', 'b'] })
    expect(body.settings).toEqual({ ttl: 3_600_000 })
    expect(body.request_id).toBe('r1')
    const pushChannel = body.push_channel as Record<string, any>
    expect(pushChannel.android.classification).toBe(1)
    const pushMessage = body.push_message as Record<string, any>
    expect(pushMessage.android.transmission).toBe(JSON.stringify({ familyId: 'f1' }))
  })

  it('小米分类审批没下来时，请求体里不留空的 category 字段', () => {
    const withCategory = buildPushBody({ ...base, pushCategory: 'service.reminder' })
    const without = buildPushBody(base)

    const categorized = (withCategory.push_channel as Record<string, any>).android
    const plain = (without.push_channel as Record<string, any>).android
    expect(categorized.category).toBe('service.reminder')
    expect(plain).not.toHaveProperty('category')
  })
})
