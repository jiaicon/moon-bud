<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { familiesApi } from '../../api/endpoints'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'
import { confirmDanger } from '../../utils/confirm'
import type { ChildDto } from '@moonbud/shared'

const familyStore = useFamilyStore()
const childStore = useChildStore()

const name = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const childTarget = ref<ChildDto | null>(null)

const familyId = computed(() => familyStore.currentFamilyId ?? '')
// u-popup 只认 v-model（modelValue），开合状态由选中的孩子推导。
const sheetOpen = computed({
  get: () => childTarget.value !== null,
  set: (open: boolean) => {
    if (!open) childTarget.value = null
  },
})
const family = computed(() => familyStore.currentFamily)
const isOwner = computed(() => family.value?.role === 'OWNER')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])

async function load(): Promise<void> {
  if (!familyId.value) return
  await familyStore.load()
  name.value = family.value?.name ?? ''
  await childStore.load(familyId.value)
}

async function rename(): Promise<void> {
  if (!familyId.value || saving.value) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = '家庭名称不能为空'
    return
  }
  saving.value = true
  error.value = null
  try {
    await familiesApi.update(familyId.value, trimmed)
    await familyStore.load()
    uni.showToast({ title: '已保存', icon: 'none' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

/**
 * 归档不删数据（spec 第 4 节），但 v1 没有恢复入口：归档后这个家庭对全家所有人都不再可达
 * （后端对 archivedAt != null 的家庭一律 403，邀请也不允许指向它）。
 * 所以文案与确认框都必须照实说，不能写"重新加入即可看到"。
 */
async function archive(): Promise<void> {
  if (!familyId.value) return
  const go = await confirmDanger({
    title: '归档这个家庭？',
    content: '归档后，你和全家任何人都再也打不开它，当前版本也没有恢复入口。记录不会删除，但界面上看不到了。',
    confirmText: '归档',
  })
  if (!go) return
  const ok = await familyStore.archive(familyId.value)
  if (ok) {
    uni.showToast({ title: '已归档', icon: 'none' })
    uni.switchTab({ url: '/pages/home/index' })
  } else {
    error.value = familyStore.error ?? '归档失败'
  }
}

async function removeChild(child: ChildDto): Promise<void> {
  const go = await confirmDanger({
    title: `移除「${child.name}」？`,
    content: '记录不会删除，但这个孩子的历史会从全家的时间线里消失，当前版本没有找回入口。请先确认孩子不是被记错了名字。',
    confirmText: '移除',
  })
  if (!go) {
    childTarget.value = null
    return
  }
  const ok = await childStore.remove(familyId.value, child.id)
  childTarget.value = null
  if (!ok) uni.showToast({ title: childStore.error ?? '移除失败', icon: 'none' })
}

const goMembers = () => uni.navigateTo({ url: '/pages/member-list/index' })
const goInvites = () => uni.navigateTo({ url: '/pages/invite-qrcode/index' })
const goAddChild = () => uni.navigateTo({ url: '/pages/child-form/index' })
const goSwitchFamily = () => uni.navigateTo({ url: '/pages/family-select/index' })

onLoad(async () => {
  await familyStore.load()
  name.value = family.value?.name ?? ''
})
onShow(() => void load())
</script>

<template>
  <theme-root>
    <view class="page">
      <view v-if="!familyId" class="notice">
        <text class="notice__text">还没有家庭。创建一个家庭后才能邀请家人、记喂奶。</text>
        <view class="btn" @click="goSwitchFamily"><text class="btn__label">去创建或加入</text></view>
      </view>

      <template v-else>
        <view class="field">
          <text class="field__label">家庭名称</text>
          <input v-model="name" class="field__input" maxlength="30" placeholder="如：小月一家" />
          <text v-if="error" class="field__error">{{ error }}</text>
          <view class="btn btn--sm" :class="{ 'btn--disabled': saving }" @click="rename">
            <text class="btn__label">{{ saving ? '保存中…' : '保存名称' }}</text>
          </view>
        </view>

        <view class="section">
          <text class="section__title">孩子</text>
          <view v-for="child in children" :key="child.id" class="row" @click="childTarget = child">
            <view class="row__main">
              <text class="row__name">{{ child.name }}</text>
              <text class="row__meta">{{ child.birthday }}</text>
            </view>
            <text class="row__chevron">›</text>
          </view>
          <view v-if="!children.length" class="row row--empty">
            <text class="row__meta">还没有孩子</text>
          </view>
          <view class="btn btn--ghost btn--sm" @click="goAddChild"><text class="btn__label">添加孩子</text></view>
        </view>

        <view class="section">
          <text class="section__title">家人</text>
          <view class="row" @click="goMembers">
            <text class="row__name">成员管理</text>
            <text class="row__chevron">›</text>
          </view>
          <view class="row" @click="goInvites">
            <text class="row__name">邀请二维码</text>
            <text class="row__chevron">›</text>
          </view>
          <view class="row" @click="goSwitchFamily">
            <text class="row__name">切换 / 创建家庭</text>
            <text class="row__chevron">›</text>
          </view>
        </view>

        <view v-if="isOwner" class="section">
          <text class="section__title">危险操作</text>
          <text class="section__hint">归档后这个家庭对全家所有人都不可访问。记录不会删除，但当前版本没有恢复入口 —— 请确认这是你想要的。</text>
          <view class="row row--danger" @click="archive">
            <text class="row__name row__name--danger">归档此家庭</text>
          </view>
        </view>
      </template>

      <u-popup v-model="sheetOpen" mode="bottom" border-radius="24" @close="childTarget = null">
        <view v-if="childTarget" class="sheet">
          <text class="sheet__title">{{ childTarget.name }}</text>
          <text class="sheet__hint">生日 {{ childTarget.birthday }}</text>
          <view class="sheet__action sheet__action--danger" @click="removeChild(childTarget)">
            <text class="sheet__action-label">移除孩子</text>
          </view>
          <view class="sheet__action" @click="childTarget = null">
            <text class="sheet__action-label sheet__action-label--muted">关闭</text>
          </view>
        </view>
      </u-popup>
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

.notice {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  padding: 40rpx 0;
}

.notice__text {
  font-size: 28rpx;
  color: var(--mb-color-text-secondary);
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
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface);
  color: var(--mb-color-text-primary);
  font-size: 28rpx;
}

.field__error {
  font-size: 24rpx;
  color: var(--mb-color-error);
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

.section__hint {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 24rpx;
  border-radius: 18rpx;
  background-color: var(--mb-color-surface);
}

.row--empty {
  opacity: 0.6;
}

.row--danger {
  border: 2rpx solid var(--mb-color-border);
}

.row__main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.row__name {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.row__name--danger {
  color: var(--mb-color-error);
}

.row__meta {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.row__chevron {
  font-size: 28rpx;
  color: var(--mb-color-text-disabled);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--sm {
  align-self: flex-start;
  height: 72rpx;
  padding: 0 32rpx;
}

.btn--ghost {
  background-color: var(--mb-color-surface-alt);
}

.btn--disabled {
  opacity: 0.6;
}

.btn__label {
  font-size: 28rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-text-primary);
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 40rpx 40rpx 56rpx;
}

.sheet__title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.sheet__hint {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.sheet__action {
  padding: 26rpx 0;
  border-bottom: 2rpx solid var(--mb-color-divider);
}

.sheet__action-label {
  font-size: 30rpx;
  color: var(--mb-color-text-primary);
}

.sheet__action--danger .sheet__action-label {
  color: var(--mb-color-error);
}

.sheet__action-label--muted {
  color: var(--mb-color-text-disabled);
}
</style>
