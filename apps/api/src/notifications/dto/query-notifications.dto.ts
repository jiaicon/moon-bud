import { Transform, Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class QueryNotificationsDto {
  /** 查询串里是字符串：显式转换，别让它落到"非空字符串即真"的陷阱里。 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  unreadOnly?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20
}
