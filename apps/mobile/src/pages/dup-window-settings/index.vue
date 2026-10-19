<script setup lang="ts">
import { computed } from 'vue'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { DEFAULT_WINDOW_MINUTES, WINDOW_CHOICES } from '../../events/duplicate-window'
import { useDupWindowStore } from '../../stores/dup-window'

const dup = useDupWindowStore()

/**
 * 每个类型一行。选择器第一项恒为"默认"（撤掉覆盖、回到内置那档），
 * 其余是候选分钟。这样家长既不用记内置值，也能一键退回。
 */
const RANGE = ['默认', ...WINDOW_CHOICES.map((m) => `${m} 分钟`)]

const rows = computed(() =>
  EVENT_TYPES.map((type) => {
    const effective = dup.windowFor(type)
    const customized = dup.isCustomized(type)
    const at = customized ? WINDOW_CHOICES.indexOf(effective as (typeof WINDOW_CHOICES)[number]) : -1
    return {
      type,
      label: `${EVENT_TYPE_META[type].icon} ${EVENT_TYPE_META[type].label}`,
      value: customized ? `${effective} 分钟` : `默认 · ${DEFAULT_WINDOW_MINUTES[type]} 分钟`,
      pickerIndex: at < 0 ? 0 : at + 1,
    }
  }),
)

function onPick(type: EventType, e: { detail: { value: string | number } }): void {
  const index = Number(e.detail.value)
  if (index <= 0) dup.set(type, null)
  else dup.set(type, WINDOW_CHOICES[index - 1])
}
</script>

<template>
  <theme-root>
    <view class="page">
      <text class="page__title">重复提醒提示</text>
      <text class="page__hint">
        记一条时，如果这个孩子在设定窗口内已有同类型的记录，表单顶部会提示"某某几分钟前刚记过一次"。
        窗口越短提示越少、越长越容易提前拦下重复喂。这里调的是你手机上的敏感度，不影响别人。
      </text>

      <view class="list">
        <picker
          v-for="row in rows"
          :key="row.type"
          :range="RANGE"
          :value="row.pickerIndex"
          @change="onPick(row.type, $event)"
        >
          <view class="row">
            <text class="row__label">{{ row.label }}</text>
            <view class="row__right">
              <text class="row__value">{{ row.value }}</text>
              <text class="row__chevron">›</text>
            </view>
          </view>
        </picker>
      </view>

      <text class="page__foot">提示只是提醒，不拦你保存——加餐、双胞胎这类正常情况照常能记。</text>
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
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
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

.row__label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.row__right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.row__value {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.row__chevron {
  font-size: 28rpx;
  color: var(--mb-color-text-disabled);
}
</style>
