import { IsString } from 'class-validator'
import { IsIanaTimezone } from '../../common/validators/is-iana-timezone'

/**
 * 只有 timezone 可改。全局 ValidationPipe 是 whitelist：不认识的字段会被静默丢掉，
 * 所以这里把 timezone 设为必填——空 body 得到 400，而不是一个什么都没改的 200。
 * 昵称、头像要等真有编辑界面时再加进这个 DTO，不能先让客户端乱发。
 */
export class UpdateMeDto {
  @IsString()
  @IsIanaTimezone()
  timezone!: string
}
