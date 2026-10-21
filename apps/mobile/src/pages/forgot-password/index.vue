<script setup lang="ts">
import { ref } from 'vue'
import { normalizeUsername } from '@moonbud/shared'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { authApi } from '../../api/endpoints'
import { stepBack } from '../../utils/back-nav'

const username = ref('')
const submitting = ref(false)

const toast = (title: string) => uni.showToast({ title, icon: 'none' })
const goBack = () => stepBack()

async function onSubmit() {
  if (submitting.value) return
  if (!username.value.trim()) {
    toast('请输入账号')
    return
  }
  submitting.value = true
  try {
    await authApi.resetRequest(normalizeUsername(username.value))
  } catch {
    // 网络失败与"账号不存在"必须分开：前者要让用户重试，后者绝不能区分出来。
    submitting.value = false
    toast('提交失败，请检查网络后重试')
    return
  }
  submitting.value = false
  // 固定文案：不区分账号是否存在，否则这一页就成了账号探测接口。
  toast('已提交，家庭里的管理员会帮你重置')
  stepBack()
}
</script>

<template>
  <theme-root>
    <view class="forgot">
      <text class="forgot__title">忘记密码</text>
      <text class="forgot__desc">
        这个应用不绑手机号和邮箱，所以没法给你发验证链接。最快的路是：联系家庭里的管理员，
        让他在「成员」页为你重置一个临时密码，登录后再改掉它。
      </text>
      <text class="forgot__desc">
        也可以提交一次找回请求：你所在家庭里的其他管理员会在提醒中心看到它。但别只等这一条——
        当面说一句还是最快的。
      </text>

      <view class="field">
        <text class="field__label">你的账号</text>
        <u-input v-model="username" placeholder="登录用的账号" :maxlength="20" />
      </view>

      <view class="btn" :class="{ 'btn--disabled': submitting }" @click="onSubmit">
        <text class="btn__label">提交找回请求</text>
      </view>
      <text class="forgot__back" @click="goBack">返回</text>
    </view>
  </theme-root>
</template>

<style scoped>
.forgot {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  padding: 48rpx;
}

.forgot__title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.forgot__desc {
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--mb-color-text-secondary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.field__label {
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
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

.forgot__back {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
  text-align: center;
}
</style>
