<script setup lang="ts">
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { fetchUnreadCount } from '../../notifications/unread'
import ThemeRoot from '../../components/ThemeRoot.vue'
import ThemeSwitcher from '../../components/ThemeSwitcher.vue'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'

const authStore = useAuthStore()
const familyStore = useFamilyStore()

const unread = ref(0)

const user = computed(() => authStore.user)
const familyName = computed(() => familyStore.currentFamily?.name ?? '还没有家庭')

async function refreshUnread(): Promise<void> {
  // 冷启动时 access token 还在路上（isLoggedIn 只是内存态）。不等会话落定就
  // 走下面的守卫，这一页会把家庭名一直说成"还没有家庭"，说到你离开本页。
  if (authStore.status === 'loading') await authStore.bootstrap()
  if (!authStore.isLoggedIn) return
  unread.value = await fetchUnreadCount()
  await familyStore.load()
}

async function logout(): Promise<void> {
  await authStore.logout()
  uni.reLaunch({ url: '/pages/welcome/index' })
}

const go = (path: string) => () => uni.navigateTo({ url: path })

onShow(() => void refreshUnread())
onPullDownRefresh(() => {
  void refreshUnread().finally(() => uni.stopPullDownRefresh())
})
</script>

<template>
  <theme-root>
    <view class="page">
      <view class="account">
        <view class="account__avatar">
          <text class="account__initial">{{ (user?.nickname ?? '?').slice(0, 1) }}</text>
        </view>
        <view class="account__main">
          <text class="account__name">{{ user?.nickname ?? '未登录' }}</text>
          <text class="account__meta">{{ user ? `@${user.username}` : '' }}</text>
          <text class="account__meta">{{ familyName }}</text>
        </view>
      </view>

      <view class="section">
        <text class="section__title">外观</text>
        <view class="card">
          <theme-switcher />
        </view>
      </view>

      <view class="section">
        <text class="section__title">家庭</text>
        <view class="row" @click="go('/pages/family-settings/index')">
          <text class="row__label">家庭设置</text>
          <text class="row__chevron">›</text>
        </view>
        <view class="row" @click="go('/pages/member-list/index')">
          <text class="row__label">成员管理</text>
          <text class="row__chevron">›</text>
        </view>
        <view class="row" @click="go('/pages/invite-qrcode/index')">
          <text class="row__label">邀请家人</text>
          <text class="row__chevron">›</text>
        </view>
        <view class="row" @click="go('/pages/theme-settings/index')">
          <text class="row__label">主题设置</text>
          <text class="row__chevron">›</text>
        </view>
      </view>

      <view class="section">
        <text class="section__title">账号</text>
        <view class="row" @click="go('/pages/change-password/index')">
          <text class="row__label">修改密码</text>
          <text class="row__chevron">›</text>
        </view>
        <view class="row" @click="go('/pages/notification-center/index')">
          <view class="row__left">
            <text class="row__label">提醒中心</text>
            <text v-if="unread" class="badge"><text class="badge__label">{{ unread }}</text></text>
          </view>
          <text class="row__chevron">›</text>
        </view>
      </view>

      <view class="section">
        <text class="section__title">关于</text>
        <view class="card card--about">
          <text class="about__name">月芽 · v0.1</text>
          <text class="about__limit">已知限制：站内提醒始终可用；APP 被关闭或在后台被系统回收时，本地推送可能不响。</text>
          <text class="about__limit">鸿蒙系统不支持本地推送，这类设备上提醒只出现在提醒中心。</text>
        </view>
      </view>

      <view class="btn btn--ghost" @click="logout"><text class="btn__label">退出登录</text></view>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 32rpx 40rpx 96rpx;
  display: flex;
  flex-direction: column;
  gap: 36rpx;
}

.account {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24rpx;
}

.account__avatar {
  width: 108rpx;
  height: 108rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
}

.account__initial {
  font-size: 44rpx;
  font-weight: 700;
  color: var(--mb-color-primary);
}

.account__main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.account__name {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.account__meta {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.section__title {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.card {
  padding: 28rpx 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.card--about {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.about__name {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.about__limit {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 24rpx;
  border-radius: 18rpx;
  background-color: var(--mb-color-surface);
}

.row__left {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
}

.row__label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.row__chevron {
  font-size: 28rpx;
  color: var(--mb-color-text-disabled);
}

.badge {
  min-width: 36rpx;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-error);
  text-align: center;
}

.badge__label {
  font-size: 20rpx;
  color: var(--mb-color-on-primary);
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
  font-size: 28rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-text-primary);
}
</style>
