<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { computed } from 'vue'
import PasswordField from '../../components/PasswordField.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { normalizeInviteCode } from '../../invite/landing-url'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'
import { useLoginForm, type LoginMode } from './use-login-form'

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const { mode, form, errors, loading, submit } = useLoginForm()

const MODES: { value: LoginMode; label: string }[] = [
  { value: 'login', label: '登录' },
  { value: 'register', label: '注册' },
  { value: 'join', label: '加入家庭' },
]

const isRegister = computed(() => mode.value !== 'login')
const title = computed(
  () => ({ login: '欢迎回来', register: '开始记录', join: '加入家人的家庭' })[mode.value],
)

const toast = (title: string) => uni.showToast({ title, icon: 'none' })

onLoad((query) => {
  const requested = String(query?.mode ?? '')
  if (requested === 'register' || requested === 'join') mode.value = requested
  // 扫码进来时邀请码已经在 URL 里了，再让人敲一遍是把简单事做难。
  const code = normalizeInviteCode(String(query?.code ?? ''))
  if (code) {
    form.inviteCode = code
    mode.value = 'join'
  }
})

function switchMode(next: LoginMode) {
  mode.value = next
  errors.value = {}
}

const goForgot = () => uni.navigateTo({ url: '/pages/forgot-password/index' })

async function onSubmit() {
  // 以 submit 的结果为准，不以 isLoggedIn 为准：见 use-login-form 的注释。
  const ok = await submit()
  if (!ok) {
    toast(errors.value.accept ?? authStore.error ?? '操作失败，请稍后重试')
    return
  }
  if (errors.value.accept) {
    toast(errors.value.accept)
    return
  }
  if (mode.value === 'join') {
    toast('已加入家庭')
    uni.switchTab({ url: '/pages/home/index' })
    return
  }
  // 管理员重置过密码的人必须先改掉临时密码，否则下次还是用它登录。
  if (authStore.mustChangePassword) {
    uni.navigateTo({ url: '/pages/change-password/index?forced=1' })
    return
  }
  if (await familyStore.load()) {
    if (familyStore.hasFamily) uni.switchTab({ url: '/pages/home/index' })
    else uni.navigateTo({ url: '/pages/family-select/index' })
  } else {
    toast(familyStore.error ?? '家庭信息加载失败')
  }
}
</script>

<template>
  <theme-root>
    <view class="login">
      <view class="login__modes">
        <view
          v-for="item in MODES"
          :key="item.value"
          class="login__mode"
          :class="{ 'login__mode--active': mode === item.value }"
          @click="switchMode(item.value)"
        >
          <text class="login__mode-label">{{ item.label }}</text>
        </view>
      </view>

      <text class="login__title">{{ title }}</text>
      <text class="login__hint">
        {{ isRegister ? '账号、密码、称呼一屏填完，三步以内就能开始记录。' : '用家庭里任意一个账号登录即可。' }}
      </text>

      <view class="login__fields">
        <view class="field">
          <view class="field__head">
            <text class="field__label">账号</text>
            <text class="field__star">*</text>
          </view>
          <u-input
            v-model="form.username"
            placeholder="4-20 位字母、数字或下划线"
            :maxlength="20"
          />
          <text v-if="errors.username" class="field__error">{{ errors.username }}</text>
        </view>

        <password-field v-model="form.password" label="密码" :error="errors.password" />

        <view v-if="isRegister" class="field">
          <view class="field__head">
            <text class="field__label">你的称呼</text>
            <text class="field__star">*</text>
          </view>
          <u-input v-model="form.nickname" placeholder="如：妈妈 / 外婆" :maxlength="20" />
          <text v-if="errors.nickname" class="field__error">{{ errors.nickname }}</text>
        </view>

        <view v-if="mode === 'join'" class="field">
          <view class="field__head">
            <text class="field__label">邀请码</text>
            <text class="field__star">*</text>
          </view>
          <u-input v-model="form.inviteCode" placeholder="家人发给你的 8 位码" :maxlength="12" />
          <text v-if="errors.inviteCode" class="field__error">{{ errors.inviteCode }}</text>
        </view>
      </view>

      <view
        class="btn"
        :class="{ 'btn--disabled': loading || authStore.status === 'loading' }"
        @click="onSubmit"
      >
        <text class="btn__label">
          {{ mode === 'login' ? '登录' : mode === 'register' ? '注册并开始' : '注册并加入家庭' }}
        </text>
      </view>

      <view class="login__links">
        <text class="login__link" @click="goForgot">忘记密码？</text>
        <text v-if="mode !== 'login'" class="login__link" @click="switchMode('login')">
          已有账号，去登录
        </text>
      </view>
    </view>
  </theme-root>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  padding: 48rpx 48rpx 96rpx;
}

.login__modes {
  display: flex;
  flex-direction: row;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
  padding: 6rpx;
}

.login__mode {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14rpx 0;
  border-radius: 999rpx;
}

.login__mode--active {
  background-color: var(--mb-color-primary);
}

.login__mode-label {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.login__mode--active .login__mode-label {
  color: var(--mb-color-on-primary);
}

.login__title {
  font-size: 44rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.login__hint {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.login__fields {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.field__head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
}

.field__label {
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
}

.field__star {
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.field__error {
  font-size: 22rpx;
  color: var(--mb-color-error);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--disabled {
  opacity: 0.5;
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}

.login__links {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

.login__link {
  font-size: 24rpx;
  color: var(--mb-color-primary);
}
</style>
