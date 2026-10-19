<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Gender } from '@moonbud/shared'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'

const familyStore = useFamilyStore()
const childStore = useChildStore()

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'MALE', label: '男宝' },
  { value: 'FEMALE', label: '女宝' },
  { value: 'UNKNOWN', label: '暂不填' },
]

const name = ref('')
const gender = ref<Gender>('UNKNOWN')
const birthday = ref('')
const errors = ref<Record<string, string>>({})
const saving = ref(false)

const familyId = computed(() => familyStore.currentFamilyId ?? '')

const today = new Date()
/** 生日不可能在未来：把上限直接给到选择器，比让用户选了再报错好。 */
const maxBirthday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

function validate(): boolean {
  const next: Record<string, string> = {}
  const trimmed = name.value.trim()
  if (!trimmed) next.name = '请输入孩子姓名'
  else if (trimmed.length > 20) next.name = '姓名不超过 20 字'
  if (!birthday.value) next.birthday = '请选择出生日期'
  else if (birthday.value > maxBirthday) next.birthday = '出生日期不能晚于今天'
  errors.value = next
  return Object.keys(next).length === 0
}

async function onSubmit(): Promise<void> {
  if (saving.value) return
  if (!familyId.value) {
    uni.showToast({ title: '请先创建或加入家庭', icon: 'none' })
    return
  }
  if (!validate()) return
  saving.value = true
  const child = await childStore.create(familyId.value, {
    name: name.value.trim(),
    gender: gender.value,
    birthday: birthday.value,
  })
  saving.value = false
  if (!child) {
    uni.showToast({ title: childStore.error ?? '添加失败', icon: 'none' })
    return
  }
  uni.showToast({ title: '已添加', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 600)
}

onLoad(async () => {
  await familyStore.load()
  if (familyId.value) await childStore.load(familyId.value)
})
</script>

<template>
  <theme-root>
    <view class="page">
      <text class="page__title">添加孩子</text>
      <text v-if="!familyId" class="page__hint">还没有家庭，先创建或加入一个。</text>

      <view class="field">
        <text class="field__label">姓名 *</text>
        <input v-model="name" class="field__input" maxlength="20" placeholder="如：小月" />
        <text v-if="errors.name" class="field__error">{{ errors.name }}</text>
      </view>

      <view class="field">
        <text class="field__label">性别</text>
        <view class="field__row">
          <view
            v-for="option in GENDERS"
            :key="option.value"
            class="chip"
            :class="{ 'chip--active': gender === option.value }"
            @click="gender = option.value"
          >
            <text class="chip__label">{{ option.label }}</text>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field__label">出生日期 *</text>
        <picker mode="date" :value="birthday" :end="maxBirthday" @change="birthday = $event.detail.value">
          <view class="picker"><text class="picker__text">{{ birthday || '选择日期' }}</text></view>
        </picker>
        <text v-if="errors.birthday" class="field__error">{{ errors.birthday }}</text>
      </view>

      <view class="btn" :class="{ 'btn--disabled': saving || !familyId }" @click="onSubmit">
        <text class="btn__label">保存</text>
      </view>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 40rpx;
  display: flex;
  flex-direction: column;
  gap: 30rpx;
}

.page__title {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.page__hint {
  font-size: 26rpx;
  color: var(--mb-color-warning);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.field__label {
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
}

.field__input {
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.field__row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.field__error {
  font-size: 22rpx;
  color: var(--mb-color-error);
}

.chip {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.chip--active {
  background-color: var(--mb-color-primary);
}

.chip__label {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.chip--active .chip__label {
  color: var(--mb-color-on-primary);
}

.picker {
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
}

.picker__text {
  font-size: 28rpx;
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
</style>
