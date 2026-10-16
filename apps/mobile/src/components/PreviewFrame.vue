<script setup lang="ts">
defineProps<{ title: string; caption: string }>()
</script>

<template>
  <view class="preview-frame">
    <view class="preview-frame__head">
      <text class="preview-frame__title">{{ title }}</text>
      <text class="preview-frame__caption">{{ caption }}</text>
    </view>
    <view class="preview-frame__body">
      <slot />
    </view>
  </view>
</template>

<style scoped>
.preview-frame {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 28rpx;
  border-radius: 24rpx;
  background-color: var(--mb-color-surface);
  border: 2rpx solid var(--mb-color-border);
}

.preview-frame__head {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.preview-frame__title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.preview-frame__caption {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.preview-frame__body {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid var(--mb-color-divider);
}
</style>
