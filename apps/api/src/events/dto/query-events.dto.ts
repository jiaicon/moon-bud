import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

/**
 * 记录列表的查询条件。
 *
 * `to` 与 `until` 都映射到同一个上界：`to` 是给"按区间看历史"用的，
 * `until` 是给防重复提示用的（"到此刻为止最近的一条"）。两个都给时
 * `until` 更窄，取它——见 EventsService.findAll。
 */
export class QueryEventsDto {
  @IsOptional()
  @IsUUID()
  childId?: string

  @IsOptional()
  @IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })
  type?: EventType

  @IsOptional()
  @IsISO8601()
  from?: string

  @IsOptional()
  @IsISO8601()
  to?: string

  @IsOptional()
  @IsISO8601()
  until?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE
}
