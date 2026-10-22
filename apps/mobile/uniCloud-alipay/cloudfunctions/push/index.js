'use strict'

/**
 * 月芽的服务端推送出口：唯一的用途是让自托管的 NestJS 能发出 uni-push 2.0 的消息。
 *
 * 为什么要有这个文件：DCloud 明确规定"使用 uni-push 2.0，服务端不支持用个推 api
 * 推送，只能用 dcloud 提供的服务端（云函数）推送"，2.0 的应用也拿不到个推
 * MasterSecret。云函数侧免鉴权，代价是这个 http 地址是公网可读的，所以自己加一道
 * 共享密钥（环境变量 PUSH_TOKEN，HBuilderX 右键云函数 → 设置环境变量）。
 *
 * 部署：HBuilderX 里右键本目录 → 上传云函数；然后在 uniCloud web 控制台把
 * 云函数 URL 化路径配成 `/push/send`（POST）。详见 apps/mobile/BUILD.md 第 7 节。
 */

const APP_ID = '__UNI__9B2D760'

/**
 * 顶层建一次：云函数实例会被复用，每次请求重新初始化没有意义。
 * appId 是 DCloud 的应用标识，不是密钥，可以进仓库。
 */
const uniPush = uniCloud.getPushManager({ appId: APP_ID })

/**
 * request_id 用于个推侧去重，官方说"重复的消息会被直接丢弃"，所以必须每次唯一；
 * 长度限 10–32 位。这里不需要幂等（发送方不重试），唯一性比可重现更重要。
 */
function requestId() {
  const tail =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return (Date.now().toString(36) + tail).slice(0, 32)
}

function readToken(event) {
  const headers = event.headers || {}
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-push-token') return headers[key]
  }
  return undefined
}

function parseBody(event) {
  let raw = event.body
  if (raw == null) return {}
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8')
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (err) {
    return null
  }
}

exports.main = async (event) => {
  const expected = process.env.PUSH_TOKEN
  if (!expected) {
    // 配了 URL 化却没配环境变量：宁可不发，也不让这道门是虚的。
    return { code: 50001, msg: 'PUSH_TOKEN 环境变量未配置' }
  }
  if (readToken(event) !== expected) {
    return { code: 401, msg: 'x-push-token 不匹配' }
  }

  const body = parseBody(event)
  if (!body) return { code: 400, msg: '请求体不是合法 JSON' }

  const { cids, title, content, payload, ttl } = body
  if (!Array.isArray(cids) || cids.length === 0) {
    return { code: 400, msg: 'cids 必须是非空数组' }
  }
  if (!title || !content) {
    return { code: 400, msg: 'title 与 content 必填' }
  }

  /**
   * 接厂商通道那天在这里补 `options`（形如
   * `options: { android: { XM: { channel_id: '...' } } }`）——限额、分类审批都
   * 是厂商侧的事，NestJS 那侧不用改。
   */
  try {
    const res = await uniPush.sendMessage({
      push_clientid: cids,
      title,
      content,
      payload: payload || {},
      // 只走个推自有长连接时，没有这一条在线消息可能只到 App 内部而不进通知栏。
      force_notification: true,
      request_id: requestId(),
      // ttl 单位按个推的毫秒理解（1 小时），真机 spike 时确认。
      settings: { ttl: ttl || 3600000 }
    })
    // sendMessage 不抛错，失败也在 errCode 里回。
    return { code: res.errCode || 0, msg: res.errMsg || 'ok', data: res.data }
  } catch (err) {
    return { code: err.code || -1, msg: err.message || String(err) }
  }
}
