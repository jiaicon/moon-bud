<script setup lang="ts">
import { PASSWORD_MIN_LENGTH } from '@moonbud/shared'
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import PasswordField from '../../components/PasswordField.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'

const authStore = useAuthStore()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errors = ref<Record<string, string>>({})
const forced = ref(false)

const loading = computed(() => authStore.status === 'loading')

const toast = (title: string) => uni.showToast({ title, icon: 'none' })

onLoad((query) => {
  forced.value = String(query?.forced ?? '') === '1'
})

function validate(): boolean {
  const next: Record<string, string> = {}
  if (!oldPassword.value) next.oldPassword = '请输入当前密码'
  if (newPassword.value.length < PASSWORD_MIN_LENGTH) {
    next.newPassword = `新密码至少 ${PASSWORD_MIN_LENGTH} 位`
  } else if (newPassword.value === oldPassword.value) {
    next.newPassword = '新密码不能和当前密码相同'
  }
  if (confirmPassword.value !== newPassword.value) next.confirmPassword = '两次输入的新密码不一致'
  errors.value = next
  return Object.keys(next).length === 0
}

async function onSubmit() {
  if (loading.value || !validate()) return
  const ok = await authStore.changePassword(oldPassword.value, newPassword.value)
  if (!ok) {
    toast(authStore.error ?? '修改失败，请稍后重试')
    return
  }
  toast('密码已修改')
  if (forced.value) uni.switchTab({ url: '/pages/home/index' })
  else uni.navigateBack()
}
</script>

<template>
  <theme-root>
    <view class="change">
      <text class="change__title">修改密码</text>
      <text v-if="forced" class="change__notice">
        管理员为你设置了临时密码，改掉它之后才能继续使用。
      </text>

      <view class="change__fields">
        <password-field v-model="oldPassword" label="当前密码" :error="errors.oldPassword" />
        <password-field v-model="newPassword" label="新密码" :error="errors.newPassword" />
        <password-field
          v-model="confirmPassword"
          label="确认新密码"
          :error="errors.confirmPassword"
        />
      </view>

      <view class="btn" :class="{ 'btn--disabled': loading }" @click="onSubmit">
        <text class="btn__label">保存</text>
      </view>
    </view>
  </theme-root>
</template>

<style scoped>
.change {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  padding: 48rpx;
}

.change__title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.change__notice {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--mb-color-warning);
}

.change__fields {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
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
</style>
