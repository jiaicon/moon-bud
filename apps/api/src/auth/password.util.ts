import * as bcrypt from 'bcryptjs'

// 用 bcryptjs（纯 JS）而不是 bcrypt（原生模块）：
//  1. bcrypt 的原生二进制在 pnpm 默认拦截安装脚本的情况下不会被构建；
//  2. 原生模块把二进制绑死在构建时的 Node ABI 上，而镜像里是 Node 22、
//     开发机是 Node 24，会在容器内以 MODULE_NOT_FOUND 崩掉。
// 家庭应用的登录频率下，纯 JS 的性能差异无意义。
const SALT_ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
