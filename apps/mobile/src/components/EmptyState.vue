<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string
    title: string
    hint?: string
    actionLabel?: string
  }>(),
  { icon: '🌙', hint: undefined, actionLabel: undefined },
)

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <view class="empty">
    <view class="empty__box">
      <text class="empty__icon">{{ icon }}</text>
      <text class="empty__title">{{ title }}</text>
      <text v-if="hint" class="empty__hint">{{ hint }}</text>
      <view v-if="actionLabel" class="empty__btn" @click="emit('action')">
        <text class="empty__btn-label">{{ actionLabel }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 整页上下居中：父级给 flex:1，这里把盒子推到可视区正中。
   min-height:0 让它可以被压回可视区，否则表情行高会把页面顶出滚动条。 */
.empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx 0;
}

.empty__box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.empty__icon {
  font-size: 64rpx;
  line-height: 1;
  opacity: 0.55;
}

.empty__title {
  font-size: 30rpx;
  color: var(--mb-color-text-primary);
}

.empty__hint {
  max-width: 480rpx;
  font-size: 24rpx;
  line-height: 1.5;
  color: var(--mb-color-text-secondary);
  text-align: center;
}

.empty__btn {
  margin-top: 12rpx;
  padding: 0 36rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.empty__btn-label {
  font-size: 26rpx;
  color: var(--mb-color-on-primary);
}
</style>
