<script setup lang="ts">
import ThemeRoot from '../../components/ThemeRoot.vue'
import ThemeSwitcher from '../../components/ThemeSwitcher.vue'
</script>

<template>
  <theme-root>
    <view class="page">
      <text class="page__title">主题</text>
      <text class="page__hint">选一套配色，切换后每个页面都会立刻跟着变。深色模式在夜间喂奶时不那么刺眼。</text>
      <theme-switcher />
      <text class="page__foot">「自动」跟随系统的深浅色设置。</text>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 32rpx 40rpx 96rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.page__title {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.page__hint,
.page__foot {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}
</style>
