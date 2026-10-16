// baseURL 只可能来自构建期注入的环境变量。
const raw = import.meta.env.VITE_API_BASE_URL as string | undefined

if (!raw) {
  // 刻意抛错：回退到 localhost 会在真机上表现为"莫名连不上"，比启动即失败更难排查
  throw new Error('缺少 VITE_API_BASE_URL，请在 apps/mobile/.env.development 中配置（真机请填开发机的局域网 IP）')
}

export const API_BASE_URL: string = raw.replace(/\/+$/, '')

// 邀请落地页的域名同样是配置项，不写死：缺配置时邀请页只展示手动邀请码。
export const INVITE_LANDING_BASE_URL: string | null = (
  (import.meta.env.VITE_INVITE_BASE_URL as string | undefined) ?? null
)
