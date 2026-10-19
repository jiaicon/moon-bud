import type { EventPayload, EventType } from './event-types'

/**
 * 账号规则。前端注册页的即时校验与后端 DTO 校验共用这一条正则，
 * 避免出现"前端说可以、后端说不行"。
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/

export const PASSWORD_MIN_LENGTH = 8

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value)
}

/** 登录账号一律小写存储与查询，因此大小写不敏感是天然行为。 */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export type FamilyRole = 'OWNER' | 'ADMIN' | 'MEMBER'

export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN'

export type ReminderType = 'ONE_TIME' | 'RECURRING'

export type ReminderStatus = 'ACTIVE' | 'DONE' | 'CANCELLED'

export type OccurrenceStatus = 'PENDING' | 'DONE' | 'SKIPPED'

/** 提醒列表的视图分段。"已过期"是查询时计算的，不落库。 */
export type ReminderListFilter = 'ACTIVE' | 'OVERDUE' | 'DONE' | 'CANCELLED'

export type ThemePresetId = 'mist-blue' | 'cream-orange' | 'mint-green' | 'dusk-purple'

export type ThemeMode = 'light' | 'dark' | 'auto'

export interface UserDto {
  id: string
  username: string
  nickname: string
  timezone: string
  avatarUrl: string | null
}

export interface FamilyDto {
  id: string
  name: string
  ownerId: string
  /** 当前登录用户在这个家庭里的角色 */
  role: FamilyRole
  archivedAt: string | null
}

export interface MemberDto {
  id: string
  userId: string
  role: FamilyRole
  displayName: string | null
  joinedAt: string
  nickname: string
  username: string
}

export interface ChildDto {
  id: string
  familyId: string
  name: string
  gender: Gender
  /** ISO 日期（YYYY-MM-DD） */
  birthday: string
  avatarUrl: string | null
  archivedAt: string | null
}

export interface EventDto {
  id: string
  childId: string
  familyId: string
  type: EventType
  occurredAt: string
  endedAt: string | null
  payload: EventPayload
  note: string | null
  createdBy: string
  /**
   * 记录人的昵称。防重复照护提示要说清"谁记的"（"爸爸 20 分钟前刚记过一次喂奶"），
   * 否则提示退化成"家人记过"，而"分不清谁做了什么"正是这个产品要解决的问题本身。
   */
  createdByNickname: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * GET /families/:familyId/children/:childId/events/latest 的响应。
 * 用 `{ event: null }` 而不是 404 表达"还没有记录"——没有记录是正常状态。
 */
export interface LatestEventResponse {
  event: EventDto | null
}

export interface ReminderDto {
  id: string
  familyId: string
  childId: string | null
  title: string
  note: string | null
  type: ReminderType
  dueAt: string | null
  rrule: string | null
  timezone: string
  assigneeId: string | null
  status: ReminderStatus
  createdBy: string
  createdAt: string
}

export interface ReminderOccurrenceDto {
  id: string
  reminderId: string
  dueAt: string
  firedAt: string | null
  status: OccurrenceStatus
  completedBy: string | null
  completedAt: string | null
}

export interface NotificationDto {
  id: string
  userId: string
  familyId: string
  occurrenceId: string | null
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

export interface InviteDto {
  id: string
  code: string
  role: FamilyRole
  expiresAt: string
  maxUses: number
  usedCount: number
  revokedAt: string | null
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: UserDto
  /** 用临时密码登录后为 true，客户端必须强制跳转修改密码 */
  mustChangePassword: boolean
}

export interface MeResponse {
  user: UserDto
  families: FamilyDto[]
  /**
   * 冷启动只有 /me 可问：/auth/refresh 不返回这个布尔，
   * 少了它，用临时密码登录后刷新一次页面，强制改密就再也拦不住。
   */
  mustChangePassword: boolean
}

export interface ApiError {
  statusCode: number
  message: string | string[]
  error: string
}

export type InviteRole = Extract<FamilyRole, 'ADMIN' | 'MEMBER'>
