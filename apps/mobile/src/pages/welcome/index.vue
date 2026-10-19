<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ThemeRoot from '../../components/ThemeRoot.vue'
import ThemeSwitcher from '../../components/ThemeSwitcher.vue'
import { hasPreviewVisited } from '../../utils/preview-visited'

const registerLabel = ref('开始使用')
const expired = ref(false)

// 会话过期被踢回来时得说清楚为什么，并且给一条回去的路：
// 欢迎页原本只有"注册/加入"，重新登录的人在这里找不到门。
onLoad((query) => {
  expired.value = String(query?.expired ?? '') === '1'
})

// 游客看过预览却没注册就离开，下次启动应当被引导回"完成注册"，而不是从头再挑一遍配色。
if (hasPreviewVisited()) {
  registerLabel.value = '继续注册'
}

const go = (url: string) => uni.navigateTo({ url })
</script>

<template>
  <theme-root>
    <view class="welcome">
      <view class="welcome__hero">
        <text class="welcome__name">月芽</text>
        <text class="welcome__slogan">一家人一起记，孩子的一天看得见</text>
        <text v-if="expired" class="welcome__notice">登录已过期，重新登录就能接着记。</text>
      </view>

      <view class="welcome__values">
        <view class="value">
          <text class="value__title">多人协作记录</text>
          <text class="value__desc">爸妈爷爷奶奶记的是同一份，谁记的、几点记的都留着</text>
        </view>
        <view class="value">
          <text class="value__title">到点提醒</text>
          <text class="value__desc">喂药、体检、该睡了，到点家里所有人一起收到</text>
        </view>
        <view class="value">
          <text class="value__title">一起看得见</text>
          <text class="value__desc">上次喂奶距今多久、今天换了几次尿布，打开首页就知道</text>
        </view>
      </view>

      <view class="welcome__actions">
        <view v-if="expired" class="btn btn--primary" @click="go('/pages/login/index')">
          <text class="btn__label btn__label--inverse">重新登录</text>
        </view>
        <view class="btn" :class="expired ? 'btn--ghost' : 'btn--primary'" @click="go('/pages/preview/index')">
          <text class="btn__label" :class="{ 'btn__label--inverse': !expired }">看看它能做什么</text>
        </view>
        <view class="btn btn--ghost" @click="go('/pages/login/index?mode=join')">
          <text class="btn__label">我收到了邀请码</text>
        </view>
        <view class="btn btn--text" @click="go('/pages/login/index?mode=register')">
          <text class="btn__label">{{ registerLabel }}</text>
        </view>
      </view>

      <view class="welcome__theme">
        <text class="welcome__theme-title">先挑一个你喜欢的配色</text>
        <theme-switcher />
      </view>
    </view>
  </theme-root>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  gap: 48rpx;
  padding: 80rpx 48rpx 64rpx;
}

.welcome__hero {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.welcome__name {
  font-size: 60rpx;
  font-weight: 700;
  color: var(--mb-color-primary);
}

.welcome__slogan {
  font-size: 28rpx;
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.welcome__notice {
  margin-top: 8rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--mb-color-error);
}

.welcome__values {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.value {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
  border: 2rpx solid var(--mb-color-border);
}

.value__title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.value__desc {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.welcome__actions {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  border-radius: 999rpx;
}

.btn--primary {
  background-color: var(--mb-color-primary);
}

.btn--ghost {
  background-color: var(--mb-color-surface);
  border: 2rpx solid var(--mb-color-primary);
}

.btn--text {
  height: 64rpx;
}

.btn__label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.btn__label--inverse {
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-primary);
}

.btn--text .btn__label {
  color: var(--mb-color-text-secondary);
  text-decoration: underline;
}

.welcome__theme {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  padding-top: 32rpx;
  border-top: 2rpx solid var(--mb-color-divider);
}

.welcome__theme-title {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}
</style>
