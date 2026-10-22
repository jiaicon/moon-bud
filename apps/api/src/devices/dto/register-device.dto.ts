import { IsIn, IsString, Length } from 'class-validator'

export class RegisterDeviceDto {
  @IsString({ message: '设备标识格式不对' })
  @Length(8, 64, { message: '设备标识不完整，请重新登录一次' })
  clientId: string

  /**
   * 只认 android：iOS 的通道要 APNs 证书与开发者账号，现在接上只会留下一条永远
   * 发不出去的设备记录。等平台真要上架再放开这个白名单。
   */
  @IsIn(['android'], { message: '目前只支持 android 设备' })
  platform: string
}

export class RemoveDeviceDto {
  @IsString({ message: '设备标识格式不对' })
  @Length(8, 64, { message: '设备标识不完整，请重新登录一次' })
  clientId: string
}
