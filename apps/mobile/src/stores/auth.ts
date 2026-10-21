import { defineStore } from 'pinia'
import type { UserDto } from '@moonbud/shared'
import { ApiRequestError } from '../api/errors'
import { renewAccessToken, setAccessToken, setRefreshHandler, setSessionExpiredHandler } from '../api/http'
import { authApi, meApi } from '../api/endpoints'
import { clearLocalNotifications } from '../notifications/local-notify'
import { resetDueWatch, startDueWatch } from '../notifications/due-watch'
import { applyUnreadBadge, refreshUnreadTabBadge } from '../notifications/tab-badge'
import { GUEST_LANDING_URL, SESSION_EXPIRED_TOAST } from '../guest/guide'
import { useChildStore } from './child'
import { useFamilyStore } from './family'
import { useOutboxStore } from './outbox'

const REFRESH_TOKEN_KEY = 'refreshToken'

function readRefreshToken(): string {
  const value = uni.getStorageSync(REFRESH_TOKEN_KEY)
  return typeof value === 'string' ? value : ''
}

/** 正在进行的冷启动静默登录；并发调用并入同一次。 */
let bootstrapFlight: Promise<void> | null = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UserDto | null,
    token: null as string | null,
    mustChangePassword: false,
    status: 'idle' as 'idle' | 'loading' | 'error',
    /**
     * 会话问过而没有答案，和问过之后答案是"没有"，是两件事。
     * `token` 是内存态，冷启动第一帧必然是 null；这时把人叫做游客，
     * 老用户每次打开应用都会先被问一遍"要不要登录"。
     */
    sessionResolved: false,
    error: null as string | null,
    /** 最近一次失败的 HTTP 状态码（网络失败是 0）。"账号已存在"这种要据此决定下一步，光看文案太脆。 */
    errorStatus: 0,
  }),

  getters: {
    isLoggedIn: (s) => s.token !== null,
    /**
     * 这一页该按哪种身份排版：还没问出来 / 确认是游客 / 确认有会话。
     * 游客判定只认这一处，四个 Tab 页各自 `!isLoggedIn` 会问出四种答案。
     */
    session: (s): 'unknown' | 'guest' | 'member' =>
      s.token !== null ? 'member' : s.sessionResolved ? 'guest' : 'unknown',
    isGuest: (s) => s.token === null && s.sessionResolved,
  },

  actions: {
    /** 401 自动续期必须由 store 装配：只有它知道 refresh token 与登录态。 */
    ensureRefreshHandler() {
      setSessionExpiredHandler(() => this.handleSessionExpired())
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
      this.clearError()
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
      this.clearError()
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
      this.clearError()
      try {
        this.applySession(await authApi.changePassword(oldPassword, newPassword))
        return true
      } catch (err) {
        this.fail(err)
        return false
      }
    },

    /**
     * 账号时区是全屏"几点"的唯一依据，注册时它取自设备且看不见。改成功才写回
     * user：失败时界面留着那个没保存上的值，比留着一个报错更糟。
     */
    async updateTimezone(timezone: string): Promise<boolean> {
      this.clearError()
      try {
        this.user = await meApi.update(timezone)
        return true
      } catch (err) {
        this.fail(err)
        return false
      }
    },

    async logout(): Promise<void> {
      // 主动退出：之后在飞的请求 401 是预期内的，不该被当成"会话过期"再甩回首页弹一句。
      setSessionExpiredHandler(null)
      try {
        await authApi.logout()
      } catch {
        // 服务端撤销失败不影响本地登出：离线时也必须能退出。
      }
      // 待同步属于"这个账号在这台机器上"：主动退出要连着这些没上传的记录一起清掉，
      // 否则下一个人登录进来，会在自己手机上看到上一个账号的"待上传"，还可能把它们
      // 真上传到自己的家庭里。（会话过期不走这里——那只是要重新登录，东西得留着。）
      useOutboxStore().clear()
      this.clearSession()
    },

    /**
     * 冷启动静默登录。没有本地凭证就保持未登录，绝不报错（Review Focus 3）。
     *
     * 页面为了不被冷启动的假守卫骗到会 await 这一个动作，于是它可能同时在飞
     * 两次：两次 /me 是白跑，而 `clearSession()` 那条分支会让后落地的那次把
     * 前一次刚建立的会话清掉。并入同一次即可。
     */
    async bootstrap(): Promise<void> {
      this.ensureRefreshHandler()
      if (bootstrapFlight) return bootstrapFlight
      bootstrapFlight = this.runBootstrap().finally(() => {
        bootstrapFlight = null
      })
      return bootstrapFlight
    },

    async runBootstrap(): Promise<void> {
      const before = readRefreshToken()
      if (!before) {
        // 本地压根没有凭证：这就是游客，问也不用问。
        this.status = 'idle'
        this.sessionResolved = true
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
        this.sessionResolved = true
      } catch (err) {
        // 连不上服务器不等于凭证过期：清会话会把服务端还认的那张 refresh token 一起扔掉，
        // 家长断网重开一次应用就得重新登录。留着会话，让页面自己说"没读到"。
        // 同理也别把人叫做游客——这一趟问不出真相，页面该说"没加载出来"而不是"来登录吧"。
        if (err instanceof ApiRequestError && err.isNetworkError) {
          this.fail(err)
          return
        }
        // 只有凭证还是我这次拿到的那一张时才清：已经被别的续期换成新凭证的话，
        // 服务端认的还是新的那张，清掉等于自己把自己登出。
        if (readRefreshToken() === before) this.clearSession()
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
      this.sessionResolved = true
      this.clearError()
      // 登录/注册是直接进 Tab 页的，不会再触发 App 的 onShow：角标不自己补这一下，
      // 这一整趟会话头顶都是空的。
      void refreshUnreadTabBadge()
      // 前台轮询也一样要在这里接手：登录页是直接换到 Tab 页的，App 的 onShow 不会为它响。
      startDueWatch()
    },

    clearSession() {
      setAccessToken(null)
      uni.setStorageSync(REFRESH_TOKEN_KEY, '')
      clearLocalNotifications()
      // 会话没了就没有"未读"这回事，角标必须跟着摘掉。
      applyUnreadBadge(0)
      // 轮询跟着停：继续跑是在替上一个账号读通知，而"哪些已经弹过"那份进度
      // 到了下一个账号身上，就会把人家真正该看到的提醒当成旧账吞掉。
      resetDueWatch()
      // 家庭与孩子是"这个账号看过的东西"，而且选中项存在设备级 storage 里。
      // 不清的话，退出后游客那一屏仍画着上一个账号的孩子名，点一下真会发出一条
      // 不带凭证的请求；下一次冷启动建 store 又会把那个 familyId 从盘上捡回来。
      useFamilyStore().reset()
      useChildStore().reset()
      this.token = null
      this.user = null
      this.mustChangePassword = false
      this.sessionResolved = true
    },

    /**
     * 凭证救不回来了：清掉会话，把人放回首页的游客态，并在那里说一句为什么。
     *
     * 不再送去登录页——正在看的东西被打断，而游客态本来就有"重新登录"这颗按钮。
     * 用 reLaunch 而不是 switchTab：人可能停在任何一个页面上，而那些页面的骨架里
     * 还挂着上一个家庭的数据。
     */
    handleSessionExpired() {
      this.clearSession()
      uni.reLaunch({ url: GUEST_LANDING_URL })
      uni.showToast({ title: SESSION_EXPIRED_TOAST, icon: 'none' })
    },

    clearError() {
      this.error = null
      this.errorStatus = 0
    },

    fail(err: unknown) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : '请求失败，请稍后重试'
      this.errorStatus = err instanceof ApiRequestError ? err.statusCode : 0
    },
  },
})
