/** 助手通道的一次请求：用户原话 + 服务端按账号读出来的时区口径。 */
export interface AssistantRequest {
  userId: string
  text: string
  timezone: string
  now: Date
}

/**
 * 解析通道。返回 `unknown` 而不是草稿类型是刻意的：**校验只有一条路**——
 * 服务层拿 `sanitizeAssistantDraft` 判它，provider 自己"已经校验过"的说法一概不信。
 */
export interface AssistantProvider {
  parse(req: AssistantRequest): Promise<unknown>
}

export const ASSISTANT_PROVIDER = 'ASSISTANT_PROVIDER'
