import { defineStore } from 'pinia'
import type { UserDto } from '@moonbud/shared'
import { setAccessToken, setRefreshHandler } from '../api/http'
import { authApi, meApi } from '../api/endpoints'

const REFRESH_TOKEN_KEY = 'refreshToken'

function readRefreshToken(): string {
  const value = uni.getStorageSync(REFRESH_TOKEN_KEY)
  return typeof value === 'string' ? value : ''
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UserDto | null,
    token: null as string | null,
    mustChangePassword: false,
    status: 'idle' as 'idle' | 'loading' | 'error',
    error: null as string | null,
  }),

  getters: {
    isLoggedIn: (s) => s.token !== null,
  },

  actions: {
    /** 401 自动续期必须由 store 装配：只有它知道 refresh token 与登录态。 */
    ensureRefreshHandler() {
      setRefreshHandler(async () => {
        const refreshToken = readRefreshToken()
        if (!refreshToken) throw new Error('本地没有登录凭证')
        const next = await authApi.refresh(refreshToken)
        uni.setStorageSync(REFRESH_TOKEN_KEY, next.refreshToken)
        setAccessToken(next.accessToken)
        this.token = next.accessToken
        return next.accessToken
      })
    },

    async register(input: {
      username: string
      password: string
      nickname: string
      timezone: string
      email?: string
      phone?: string
    }): Promise<boolean> {
      this.ensureRefreshHandler()
      this.status = 'loading'
      this.error = null
      try {
        this.applySession(await authApi.register(input))
        return true
      } catch (err) {
        this.fail(err)
        return false
      }
    },

    async login(username: string, password: string): Promise<boolean> {
      this.ensureRefreshHandler()
      this.status = 'loading'
      this.error = null
      try {
        this.applySession(await authApi.login(username, password))
        return true
      } catch (err) {
        this.fail(err)
        return false
      }
    },

    async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
      this.status = 'loading'
      this.error = null
      try {
        this.applySession(await authApi.changePassword(oldPassword, newPassword))
        return true
      } catch (err) {
        this.fail(err)
        return false
      }
    },

    async logout(): Promise<void> {
      try {
        await authApi.logout()
      } catch {
        // 服务端撤销失败不影响本地登出：离线时也必须能退出。
      }
      this.clearSession()
    },

    /** 冷启动静默登录。没有本地凭证就保持未登录，绝不报错（Review Focus 3）。 */
    async bootstrap(): Promise<void> {
      this.ensureRefreshHandler()
      const refreshToken = readRefreshToken()
      if (!refreshToken) {
        this.status = 'idle'
        return
      }
      this.status = 'loading'
      try {
        const tokens = await authApi.refresh(refreshToken)
        uni.setStorageSync(REFRESH_TOKEN_KEY, tokens.refreshToken)
        setAccessToken(tokens.accessToken)
        this.token = tokens.accessToken
        const me = await meApi.get()
        this.user = me.user
        // 强制改密标记必须由 /me 恢复：登录响应早就随刷新丢了。
        this.mustChangePassword = me.mustChangePassword
        this.status = 'idle'
      } catch (err) {
        this.clearSession()
        this.fail(err)
      }
    },

    applySession(res: { accessToken: string; refreshToken: string; user: UserDto; mustChangePassword: boolean }) {
      setAccessToken(res.accessToken)
      uni.setStorageSync(REFRESH_TOKEN_KEY, res.refreshToken)
      this.token = res.accessToken
      this.user = res.user
      this.mustChangePassword = res.mustChangePassword
      this.status = 'idle'
      this.error = null
    },

    clearSession() {
      setAccessToken(null)
      uni.setStorageSync(REFRESH_TOKEN_KEY, '')
      this.token = null
      this.user = null
      this.mustChangePassword = false
    },

    fail(err: unknown) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : '请求失败，请稍后重试'
    },
  },
})
