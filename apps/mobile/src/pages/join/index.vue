<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { invitesApi } from '../../api/endpoints'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { normalizeInviteCode } from '../../invite/landing-url'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'

const authStore = useAuthStore()
const familyStore = useFamilyStore()

const code = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

async function accept(nextCode: string): Promise<void> {
  busy.value = true
  try {
    const family = await invitesApi.accept(nextCode)
    // 加进去的那个家庭必须显式选中：靠"当前 id 失效才回退第一项"的话，
    // 手里已有别的家庭的人会跳回旧家庭，以为自己没加入成功。
    await familyStore.load()
    familyStore.switchFamily(family.id)
    uni.showToast({ title: '已加入家庭', icon: 'none' })
    setTimeout(() => uni.switchTab({ url: '/pages/home/index' }), 600)
  } catch (err) {
    // 邀请码可能是过期、被撤销、用完了，也可能是自己那张：文案统一成人话。
    message.value =
      err instanceof Error && err.message ? err.message : '这个邀请码用不了，请让家人重新生成一个'
  } finally {
    busy.value = false
  }
}

function goLogin(): void {
  uni.navigateTo({ url: `/pages/login/index?mode=join&code=${code.value}` })
}

const goHome = () => uni.switchTab({ url: '/pages/home/index' })

onLoad(async (query) => {
  const raw = String(query?.code ?? '')
  code.value = normalizeInviteCode(raw)
  if (!code.value) {
    message.value = '链接里没有邀请码。让家人重新发一次，或者在登录页手动输入邀请码。'
    return
  }
  // 冷启动直接落在这一页时本地只有 refresh token，必须等静默登录出结果再决定走哪条路。
  if (authStore.status === 'loading') await authStore.bootstrap()
  if (authStore.isLoggedIn) {
    await accept(code.value)
    return
  }
  goLogin()
})
</script>

<template>
  <theme-root>
    <view class="page">
      <text class="page__title">加入家人的家庭</text>

      <view v-if="code" class="code">
        <text class="code__label">邀请码</text>
        <text class="code__value">{{ code }}</text>
      </view>

      <text v-if="busy" class="page__hint">正在把你加进去…</text>
      <text v-else-if="message" class="page__error">{{ message }}</text>

      <view v-if="message" class="btn" @click="goLogin"><text class="btn__label">用邀请码登录</text></view>
      <view v-if="message" class="btn btn--ghost" @click="goHome"><text class="btn__label">先自己看看</text></view>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 60rpx 40rpx;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.page__title {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.page__hint {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.page__error {
  font-size: 26rpx;
  line-height: 1.5;
  color: var(--mb-color-error);
}

.code {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 28rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.code__label {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.code__value {
  font-size: 44rpx;
  font-weight: 700;
  letter-spacing: 6rpx;
  color: var(--mb-color-primary);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--ghost {
  background-color: var(--mb-color-surface-alt);
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-text-primary);
}
</style>
