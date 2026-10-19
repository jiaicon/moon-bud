import { defineStore } from 'pinia'
import type { UserDto } from '@moonbud/shared'
import { renewAccessToken, setAccessToken, setRefreshHandler } from '../api/http'
import { authApi, meApi } from '../api/endpoints'
import { clearPreviewVisited } from '../utils/preview-visited'

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
      const before = readRefreshToken()
      if (!before) {
        this.status = 'idle'
        return
      }
      this.status = 'loading'
      try {
        // 走 http 的 single-flight：页面请求这时也可能撞上 401 并发起同一次续期，
        // 两条各自转发的路径里后到的那条会被服务端当成重放。
        await renewAccessToken()
        const me = await meApi.get()
        this.user = me.user
        // 强制改密标记必须由 /me 恢复：登录响应早就随刷新丢了。
        this.mustChangePassword = me.mustChangePassword
        this.status = 'idle'
      } catch (err) {
        // 只有凭证还是我这次拿到的那一张时才清：已经被别的续期换成新凭证的话，
        // 服务端认的还是新的那张，清掉等于自己把自己登出。
        if (readRefreshToken() === before) this.clearSession()
        this.fail(err)
      }
    },

    applySession(res: { accessToken: string; refreshToken: string; user: UserDto; mustChangePassword: boolean }) {
      setAccessToken(res.accessToken)
      uni.setStorageSync(REFRESH_TOKEN_KEY, res.refreshToken)
      // 会话一建立，"看过预览"这个游客标记就该作废：不然注册过的人每次冷启动
      // 都被欢迎页当成没注册完，按钮一直写着"继续注册"。
      clearPreviewVisited()
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
