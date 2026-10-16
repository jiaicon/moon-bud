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
