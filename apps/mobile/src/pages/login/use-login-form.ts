import { isSupportedTimezone, isValidUsername, normalizeUsername, PASSWORD_MIN_LENGTH } from '@moonbud/shared'
import { reactive, ref } from 'vue'
import { invitesApi } from '../../api/endpoints'
import { normalizeInviteCode } from '../../invite/landing-url'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'

export type LoginMode = 'login' | 'register' | 'join'

export interface LoginFormFields {
  username: string
  password: string
  nickname: string
  inviteCode: string
  timezone: string
}

export interface LoginValidationInput {
  mode: LoginMode
  username: string
  password: string
  nickname?: string
  inviteCode?: string
}

/**
 * 设备时区必须在提交前就落到受支持清单内：后端对不支持的时区直接 400，
 * 而"注册失败"的原因显示成时区，用户完全无从下手。
 */
export function deviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isSupportedTimezone(tz) ? tz : 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

const USERNAME_RULE_HINT = '4-20 位字母、数字或下划线'

export function validateLoginForm(input: LoginValidationInput): Record<string, string> {
  const errors: Record<string, string> = {}

  const username = input.username.trim()
  if (!username) {
    errors.username = '请输入账号'
  } else if (!isValidUsername(username)) {
    errors.username = `账号需为 ${USERNAME_RULE_HINT}`
  }

  if (!input.password) {
    errors.password = '请输入密码'
  } else if (input.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `密码至少 ${PASSWORD_MIN_LENGTH} 位`
  }

  if (input.mode !== 'login' && !input.nickname?.trim()) {
    errors.nickname = '请输入你的称呼（家人看得懂就行，如"妈妈"）'
  }

  if (input.mode === 'join' && !input.inviteCode?.trim()) {
    errors.inviteCode = '请输入邀请码'
  }

  return errors
}

export function useLoginForm() {
  const authStore = useAuthStore()
  const familyStore = useFamilyStore()

  const mode = ref<LoginMode>('login')
  const form = reactive<LoginFormFields>({
    username: '',
    password: '',
    nickname: '',
    inviteCode: '',
    timezone: deviceTimezone(),
  })
  const errors = ref<Record<string, string>>({})
  const loading = ref(false)
  /** 这次提交其实是"用已有账号登录"，页面要说清楚，别让人以为新建了账号。 */
  const usedExistingAccount = ref(false)

  function validate(): boolean {
    errors.value = validateLoginForm({
      mode: mode.value,
      username: form.username,
      password: form.password,
      nickname: form.nickname,
      inviteCode: form.inviteCode,
    })
    return Object.keys(errors.value).length === 0
  }

  /**
   * 成功与否必须由返回值说话，不能看 `isLoggedIn`：本地可能还留着上一次
   * 注册的会话，那次登录失败也照样"已登录"，页面就会把错误吞掉直接跳转。
   */
  async function submit(): Promise<boolean> {
    if (loading.value || !validate()) return false
    loading.value = true
    usedExistingAccount.value = false
    try {
      const username = normalizeUsername(form.username)
      const ok =
        mode.value === 'login'
          ? await authStore.login(username, form.password)
          : await authStore.register({
              username,
              password: form.password,
              nickname: form.nickname.trim(),
              timezone: form.timezone,
            })
      // 扫邀请码进来的人常常早就有账号。撞车就当登录再走一次：
      // 停在"该账号已被使用"里既进不去，手里的邀请码也白抄一遍。
      if (!ok && mode.value !== 'login' && authStore.errorStatus === 409) {
        if (!(await authStore.login(username, form.password))) return false
        usedExistingAccount.value = true
      } else if (!ok) {
        return false
      }
      if (mode.value !== 'join') return true

      try {
        const family = await invitesApi.accept(normalizeInviteCode(form.inviteCode))
        await familyStore.load()
        // 已经选中着别的家庭的人加入新家庭后必须切过去，否则他停在旧家庭里，
        // 以为"加入"没生效。
        familyStore.switchFamily(family.id)
      } catch (err) {
        // 账号已经建好了，只有"加入家庭"这一步失败：单独提示，别让用户以为注册白做。
        errors.value.accept = err instanceof Error ? err.message : '加入家庭失败，请检查邀请码'
      }
      return true
    } finally {
      loading.value = false
    }
  }

  return { mode, form, errors, loading, usedExistingAccount, validate, submit }
}
