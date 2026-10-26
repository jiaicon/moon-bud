/**
 * 助手通道的三种失败，调用方靠**类型**分辨，不靠文案：
 * 文案给人看（且要改），状态码给机器看。三者都写 `name`，
 * 因为日志里一个匿名 Error 打出来只有堆栈，看不出是哪一条路断的。
 */

/** 通道没配（没 API key）或明确不可用：客户端该说"助手还没上线"，而不是"没看懂"。 */
export class AssistantUnavailableError extends Error {
  constructor(message = '助手通道未配置') {
    super(message)
    this.name = 'AssistantUnavailableError'
  }
}

/** 上游超时：这是"再试一次也许就成"，与坏输出不同，值得单独一个码。 */
export class AssistantTimeoutError extends Error {
  constructor(message = '助手响应超时') {
    super(message)
    this.name = 'AssistantTimeoutError'
  }
}

/** 模型回的东西过不了契约：同一句原话大概率还会回同样的坏东西，重试无益。 */
export class AssistantBadOutputError extends Error {
  constructor(message = '助手返回的内容不符合契约', readonly details: string[] = []) {
    super(message)
    this.name = 'AssistantBadOutputError'
  }
}
