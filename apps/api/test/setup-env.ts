import { existsSync } from 'node:fs'
import { config } from 'dotenv'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

// 根 .env 给密钥与端口；数据库连接由 .env.test 覆盖，见下面的说明。
config({ path: resolve(ROOT, '.env') })

/**
 * `resetDatabase()` 会 TRUNCATE 全部业务表，而根 .env 里的 DATABASE_URL 指的就是
 * 开发库——跑一次测试清一次家，且没有任何提示。所以测试库必须在 .env.test 里显式写死，
 * 少了它就当场失败，而不是等数据没了才发现。
 */
const testEnvPath = resolve(ROOT, '.env.test')
if (!existsSync(testEnvPath)) {
  throw new Error(
    '缺少 .env.test：e2e 会 TRUNCATE 全部业务表，请在仓库根目录的 .env.test 里用 DATABASE_URL 指向独立的测试库（如 moonbud_test）。',
  )
}
config({ path: testEnvPath, override: true })

if (!process.env.DATABASE_URL) {
  throw new Error('.env.test 里没有 DATABASE_URL：e2e 需要它指向独立的测试库。')
}

if (!process.env.JWT_ACCESS_SECRET) {
  process.env.JWT_ACCESS_SECRET = 'test_access_secret'
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret'
}

// 关掉每分钟的真实 cron：它不受测试控制，会在别的 suite 清库清到一半时醒来，
// 打出与真实缺陷无关的错误并污染计数。测试一律用 `scheduler.tick()` 显式驱动。
process.env.SCHEDULER_ENABLED = 'false'
