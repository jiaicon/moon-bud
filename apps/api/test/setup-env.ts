import { config } from 'dotenv'
import { resolve } from 'node:path'

// e2e 测试从仓库根读取同一份 .env，避免测试与开发连到不同的库。
config({ path: resolve(__dirname, '../../../.env') })

if (!process.env.JWT_ACCESS_SECRET) {
  process.env.JWT_ACCESS_SECRET = 'test_access_secret'
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret'
}

// 关掉每分钟的真实 cron：它不受测试控制，会在别的 suite 清库清到一半时醒来，
// 打出与真实缺陷无关的错误并污染计数。测试一律用 `scheduler.tick()` 显式驱动。
process.env.SCHEDULER_ENABLED = 'false'
