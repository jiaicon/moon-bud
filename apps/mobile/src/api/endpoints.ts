import type {
  AssistantIntentHint,
  AssistantParseDto,
  AuthResponse,
  ChildDto,
  DeviceDto,
  EventDto,
  EventType,
  FamilyDto,
  FamilyRole,
  InviteDto,
  InviteRole,
  LatestEventResponse,
  MeResponse,
  MemberDto,
  NotificationDto,
  Paginated,
  ReminderDto,
  ReminderListFilter,
  ReminderOccurrenceDto,
  ThemePresetId,
  UserDto,
} from '@moonbud/shared'
import { apiRequest, type Query } from './http'

/** `GET /families/:familyId` 的返回：家庭 + 成员。shared 里没有这个组合类型，客户端在此声明。 */
export type FamilyDetailDto = FamilyDto & { members: MemberDto[] }

export interface RegisterInput {
  username: string
  password: string
  nickname: string
  timezone: string
  email?: string
  phone?: string
}

export interface EventCreateInput {
  /**
   * 客户端预生成的记录 id，只在离线出箱重放这条创建时带上：后端认它做幂等，
   * 响应丢了再重放也不会多出第二条。在线新建也一律先定好这个 id 再发，
   * 否则"失败后才补 id"补不出原来那一条（见 stores/outbox.ts 的 submitCreate）。
   */
  id?: string
  childId: string
  type: EventDto['type']
  occurredAt: string
  endedAt?: string | null
  payload: unknown
  note?: string | null
  /**
   * 「记一笔」生成的记录带上出处。只有创建能带，PATCH 不收（见 update）。
   * 允许显式 null：手记的那一笔就是"没有出处"，而服务端的 @IsOptional 认 null，
   * 出箱落盘时 undefined 会被 JSON 丢掉、null 会留着——两者都要能表达同一件事，
   * 留 null 这一种才和 note/endedAt 的写法一致。
   */
  fromReminderId?: string | null
}

export interface ReminderCreateInput {
  title: string
  type: ReminderDto['type']
  childId?: string | null
  note?: string | null
  dueAt?: string | null
  rrule?: string | null
  timezone?: string
  assigneeId?: string | null
  /** 「到点顺手记」：只带类型 = 到点跳表单；类型 + 完整预填 = 到点直接记。半份预填服务端会 400。 */
  eventType?: EventType | null
  actionPayload?: Record<string, unknown> | null
}

/**
 * PATCH 的 dueAt 只接受一个时刻：DTO 的 @IsOptional 对 null 是直接放行校验的，
 * 而服务端 new Date(null) 会得到 1970-01-01 —— 提醒不报错，只是再也不会响。
 */
export type ReminderUpdateInput = Partial<Omit<ReminderCreateInput, 'dueAt'>> & { dueAt?: string }

export const authApi = {
  register: (input: RegisterInput) => apiRequest<AuthResponse>('/auth/register', { method: 'POST', data: input, auth: false }),
  login: (username: string, password: string) => apiRequest<AuthResponse>('/auth/login', { method: 'POST', data: { username, password }, auth: false }),
  refresh: (refreshToken: string) => apiRequest<{ accessToken: string; refreshToken: string }>('/auth/refresh', { method: 'POST', data: { refreshToken }, auth: false }),
  changePassword: (oldPassword: string, newPassword: string) =>
    apiRequest<AuthResponse>('/auth/change-password', { method: 'POST', data: { oldPassword, newPassword } }),
  resetRequest: (username: string) => apiRequest<{ message: string }>('/auth/reset-request', { method: 'POST', data: { username }, auth: false }),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
}

export const meApi = {
  get: () => apiRequest<MeResponse>('/me'),
  /**
   * PATCH /me 服务端只认 timezone，别的字段会被 whitelist 静默丢掉——类型上也就只给
   * 这一个参数，免得以后有人顺手把昵称塞进来还以为改上了。
   */
  update: (timezone: string) => apiRequest<UserDto>('/me', { method: 'PATCH', data: { timezone } }),
}

export const familiesApi = {
  // 家庭永不硬删除（spec 第 4 节）：这里只有 archive / leave / transfer，没有 remove。
  list: () => apiRequest<FamilyDto[]>('/families'),
  create: (name: string) => apiRequest<FamilyDto>('/families', { method: 'POST', data: { name } }),
  get: (familyId: string) => apiRequest<FamilyDetailDto>(`/families/${familyId}`),
  update: (familyId: string, name: string) => apiRequest<FamilyDto>(`/families/${familyId}`, { method: 'PATCH', data: { name } }),
  archive: (familyId: string) => apiRequest<FamilyDto>(`/families/${familyId}/archive`, { method: 'POST' }),
  transfer: (familyId: string, toUserId: string) => apiRequest<FamilyDto>(`/families/${familyId}/transfer`, { method: 'POST', data: { toUserId } }),
  leave: (familyId: string) => apiRequest<void>(`/families/${familyId}/leave`, { method: 'POST' }),
}

export const membersApi = {
  list: (familyId: string) => apiRequest<MemberDto[]>(`/families/${familyId}/members`),
  // 只改角色：displayName 那个形参从来没人传，而 DTO 的 @IsOptional 对 null 是直接放行校验的，
  // 传下去会真的把家人给自己起的备注名清掉。
  updateRole: (familyId: string, memberId: string, role: Exclude<FamilyRole, 'OWNER'>) =>
    apiRequest<MemberDto>(`/families/${familyId}/members/${memberId}`, { method: 'PATCH', data: { role } }),
  remove: (familyId: string, memberId: string) => apiRequest<void>(`/families/${familyId}/members/${memberId}`, { method: 'DELETE' }),
  resetPassword: (familyId: string, memberId: string) =>
    apiRequest<{ temporaryPassword: string }>(`/families/${familyId}/members/${memberId}/reset-password`, { method: 'POST' }),
}

export const invitesApi = {
  create: (familyId: string, role: InviteRole, expiresInHours?: number, maxUses?: number) =>
    apiRequest<InviteDto>(`/families/${familyId}/invites`, { method: 'POST', data: { role, expiresInHours, maxUses } }),
  list: (familyId: string) => apiRequest<InviteDto[]>(`/families/${familyId}/invites`),
  revoke: (familyId: string, inviteId: string) => apiRequest<void>(`/families/${familyId}/invites/${inviteId}`, { method: 'DELETE' }),
  accept: (code: string) => apiRequest<FamilyDto>(`/invites/${code}/accept`, { method: 'POST' }),
}

export const childrenApi = {
  list: (familyId: string) => apiRequest<ChildDto[]>(`/families/${familyId}/children`),
  create: (familyId: string, input: { name: string; gender: ChildDto['gender']; birthday: string; avatarUrl?: string | null }) =>
    apiRequest<ChildDto>(`/families/${familyId}/children`, { method: 'POST', data: input }),
  update: (familyId: string, childId: string, input: Partial<{ name: string; gender: ChildDto['gender']; birthday: string; avatarUrl: string | null }>) =>
    apiRequest<ChildDto>(`/families/${familyId}/children/${childId}`, { method: 'PATCH', data: input }),
  remove: (familyId: string, childId: string) => apiRequest<void>(`/families/${familyId}/children/${childId}`, { method: 'DELETE' }),
}

export const eventsApi = {
  list: (familyId: string, query?: Query) => apiRequest<Paginated<EventDto>>(`/families/${familyId}/events`, { query }),
  create: (familyId: string, input: EventCreateInput) => apiRequest<EventDto>(`/families/${familyId}/events`, { method: 'POST', data: input }),
  // PATCH 没有 childId 也没有 fromReminderId 这两个字段（UpdateEventDto），whitelist 会静默丢掉：
  // 类型里也不许出现"把记录挪到另一个孩子""改它的出处"这种承诺。
  update: (familyId: string, eventId: string, input: Partial<Omit<EventCreateInput, 'childId' | 'fromReminderId'>>) =>
    apiRequest<EventDto>(`/families/${familyId}/events/${eventId}`, { method: 'PATCH', data: input }),
  remove: (familyId: string, eventId: string) => apiRequest<void>(`/families/${familyId}/events/${eventId}`, { method: 'DELETE' }),
  latest: (familyId: string, childId: string, type: EventDto['type']) =>
    apiRequest<LatestEventResponse>(`/families/${familyId}/children/${childId}/events/latest`, { query: { type } }),
}

export const remindersApi = {
  list: (familyId: string, status?: ReminderListFilter, query?: Query) =>
    apiRequest<Paginated<ReminderDto>>(`/families/${familyId}/reminders`, { query: { status, ...query } }),
  create: (familyId: string, input: ReminderCreateInput) => apiRequest<ReminderDto>(`/families/${familyId}/reminders`, { method: 'POST', data: input }),
  get: (familyId: string, reminderId: string) => apiRequest<ReminderDto>(`/families/${familyId}/reminders/${reminderId}`),
  update: (familyId: string, reminderId: string, input: ReminderUpdateInput) =>
    apiRequest<ReminderDto>(`/families/${familyId}/reminders/${reminderId}`, { method: 'PATCH', data: input }),
  complete: (familyId: string, reminderId: string, occurrenceId?: string | null) =>
    apiRequest<ReminderDto>(`/families/${familyId}/reminders/${reminderId}/complete`, { method: 'POST', data: { occurrenceId } }),
  cancel: (familyId: string, reminderId: string) => apiRequest<void>(`/families/${familyId}/reminders/${reminderId}`, { method: 'DELETE' }),
  occurrences: (familyId: string, reminderId: string) =>
    apiRequest<ReminderOccurrenceDto[]>(`/families/${familyId}/reminders/${reminderId}/occurrences`),
}

export const notificationsApi = {
  list: (query?: Query) => apiRequest<Paginated<NotificationDto>>('/notifications', { query }),
  markRead: (id: string) => apiRequest<NotificationDto>(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: () => apiRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
}

/**
 * 推送设备登记。后端只认 cid 不认人是谁的设备，所以 cid 一旦变（重装、清数据）
 * 就要重新上报，旧的那行会被后来者接管。
 */
export const devicesApi = {
  register: (clientId: string) =>
    apiRequest<void>('/devices/push-client', { method: 'POST', data: { clientId, platform: 'android' } }),
  unregister: (clientId: string) =>
    apiRequest<void>('/devices/push-client', { method: 'DELETE', data: { clientId } }),
  list: () => apiRequest<DeviceDto[]>('/devices/push-clients'),
}

/** 一句话记录：服务端把原话换成草稿，客户端只负责把草稿搬进表单。 */
export const assistantApi = {
  /** `intentHint` 是人在面板上确认过的那一个意图（"是要记一笔，还是设提醒"点了一下）。 */
  parse: (text: string, intentHint?: AssistantIntentHint) =>
    apiRequest<AssistantParseDto>('/assistant/parse', {
      method: 'POST',
      data: intentHint ? { text, intentHint } : { text },
    }),
}

export type { ThemePresetId }
