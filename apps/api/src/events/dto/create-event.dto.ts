import { IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'

/**
 * payload 的类型故意留成"任意对象"：它的形状取决于 type，只有在 service 里
 * 拿到 type 之后才能用 shared 的 zod schema 校验。
 */
export class CreateEventDto {
  /**
   * 客户端可自带记录 id，用来让"离线重放的创建"落到同一条上而不是重复一条：
   * 弱网下 POST 可能已经写进库、只是响应没回到客户端，重放就会凭空多出第二条喂奶。
   * 只接受 UUID；带上 id 时见 EventsService.create 的幂等分支。不传则服务端生成（照旧）。
   */
  @IsOptional()
  @IsUUID()
  id?: string

  @IsUUID()
  childId!: string

  @IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })
  type!: EventType

  @IsISO8601()
  occurredAt!: string

  @IsOptional()
  @IsISO8601()
  endedAt?: string

  @IsObject()
  payload!: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  /**
   * 「记一笔」一键生成的记录带上它是从哪条提醒顺手记的，用于以后统计"提醒真的有用吗"。
   * 只有创建能带：出处不是可编辑属性，见 UpdateEventDto 故意没有它。
   */
  @IsOptional()
  @IsUUID()
  fromReminderId?: string
}
