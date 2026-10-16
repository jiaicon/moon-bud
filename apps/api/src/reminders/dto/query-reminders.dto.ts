import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import type { ReminderListFilter } from '@moonbud/shared'

export class QueryRemindersDto {
  /**
   * 省略即不过滤（返回全部状态）。
   * `OVERDUE` 不是库里的一种状态，而是"活跃 + 存在已到期未完成的实例"，
   * 由 RemindersService 翻译（spec 第 9 节的三段式列表）。
   */
  @IsOptional()
  @IsIn(['ACTIVE', 'OVERDUE', 'DONE', 'CANCELLED'])
  status?: ReminderListFilter

  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20
}
