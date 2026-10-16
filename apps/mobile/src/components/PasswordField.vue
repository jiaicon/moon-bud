<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    placeholder?: string
    error?: string
    required?: boolean
  }>(),
  { placeholder: '', error: '', required: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const hint = computed(() => props.placeholder || `请输入${props.label}`)
</script>

<template>
  <view class="field">
    <view class="field__head">
      <text class="field__label">{{ label }}</text>
      <text v-if="required" class="field__star">*</text>
    </view>
    <!-- u-input 的 type="password" 自带"显示/隐藏"小眼睛，不必自己造一遍 -->
    <u-input
      :model-value="props.modelValue"
      :placeholder="hint"
      type="password"
      :maxlength="64"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <text v-if="error" class="field__error">{{ error }}</text>
  </view>
</template>

<style scoped>
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
</style>
