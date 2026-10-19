<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { membersApi } from '../../api/endpoints'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'
import { confirmDanger } from '../../utils/confirm'
import type { FamilyRole, MemberDto } from '@moonbud/shared'

const ROLE_LABEL: Record<FamilyRole, string> = {
  OWNER: '创建者',
  ADMIN: '管理员',
  MEMBER: '普通成员',
}

const familyStore = useFamilyStore()
const authStore = useAuthStore()

const members = ref<MemberDto[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const target = ref<MemberDto | null>(null)
const tempPassword = ref('')

const familyId = computed(() => familyStore.currentFamilyId ?? '')
// u-popup 走 Vue3 的 v-model（modelValue），没有 `show` 这个 prop，
// 所以开合状态必须是可写的 computed，由数据本身推导。
const sheetOpen = computed({
  get: () => target.value !== null,
  set: (open: boolean) => {
    if (!open) target.value = null
  },
})
const tempOpen = computed({
  get: () => tempPassword.value.length > 0,
  set: (open: boolean) => {
    if (!open) tempPassword.value = ''
  },
})
const myRole = computed(() => familyStore.currentFamily?.role ?? 'MEMBER')
/** 管理按钮只对 OWNER/ADMIN 显示：给普通成员一个点了必 403 的按钮，比不显示更糟。 */
const canManage = computed(() => myRole.value === 'OWNER' || myRole.value === 'ADMIN')
const isOwner = computed(() => myRole.value === 'OWNER')

function isSelf(member: MemberDto): boolean {
  return member.userId === authStore.user?.id
}

async function load(): Promise<void> {
  if (!familyId.value) return
  loading.value = true
  error.value = null
  try {
    members.value = await membersApi.list(familyId.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '成员加载失败'
  } finally {
    loading.value = false
  }
}

async function changeRole(member: MemberDto, role: Exclude<FamilyRole, 'OWNER'>): Promise<void> {
  try {
    await membersApi.updateRole(familyId.value, member.id, role)
    target.value = null
    uni.showToast({ title: '已更新', icon: 'none' })
    await load()
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '角色调整失败', icon: 'none' })
  }
}

async function remove(member: MemberDto): Promise<void> {
  const go = await confirmDanger({
    title: `把「${member.displayName || member.nickname || member.username || '这位成员'}」移出家庭？`,
    content: 'TA 会立刻看不到这个家庭的所有记录，也无法再用旧的邀请码进来；要回来得再生成一个邀请。TA 已经记下的内容不会因此删除。',
    confirmText: '移出',
  })
  if (!go) return
  try {
    await membersApi.remove(familyId.value, member.id)
    target.value = null
    uni.showToast({ title: '已移出家庭', icon: 'none' })
    await load()
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '移除失败', icon: 'none' })
  }
}

/**
 * 临时密码只在响应里出现一次，服务端存的是哈希：一旦关掉弹窗就再也看不到，
 * 只能重置出新的一个。因此弹窗上把这句话写死，别让管理员以为能翻历史。
 */
async function resetPassword(member: MemberDto): Promise<void> {
  try {
    const res = await membersApi.resetPassword(familyId.value, member.id)
    tempPassword.value = res.temporaryPassword
    target.value = null
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '重置失败', icon: 'none' })
  }
}

function copyTemp(): void {
  if (!tempPassword.value) return
  uni.setClipboardData({ data: tempPassword.value })
}

function closeTemp(): void {
  tempPassword.value = ''
}

const goInvites = () => uni.navigateTo({ url: '/pages/invite-qrcode/index' })
const goFamilySettings = () => uni.navigateTo({ url: '/pages/family-settings/index' })

onLoad(async () => {
  await familyStore.load()
  await load()
})
onShow(() => void load())
</script>

<template>
  <theme-root>
    <view class="page">
      <view class="head">
        <text class="head__title">{{ members.length }} 位家人</text>
        <text v-if="canManage" class="head__link" @click="goInvites">邀请家人 ›</text>
      </view>
      <text class="head__hint">成员在这里调整身份；普通成员只能看和记，管理员可以管理成员与孩子。</text>

      <text v-if="error" class="page__error">{{ error }}</text>

      <view v-for="member in members" :key="member.id" class="card" @click="target = member">
        <view class="card__main">
          <text class="card__name">{{ member.displayName || member.nickname }}</text>
          <text class="card__meta">@{{ member.username }}</text>
        </view>
        <text class="card__role" :class="{ 'card__role--owner': member.role === 'OWNER' }">{{ ROLE_LABEL[member.role] }}</text>
      </view>

      <u-empty v-if="!loading && !members.length && !error" mode="list" text="还没有成员" />

      <view v-if="isOwner" class="foot" @click="goFamilySettings"><text class="foot__label">家庭设置 ›</text></view>

      <u-popup v-model="sheetOpen" mode="bottom" border-radius="24" @close="target = null">
        <view v-if="target" class="sheet">
          <text class="sheet__title">{{ target.displayName || target.nickname }}</text>
          <text class="sheet__subtitle">{{ ROLE_LABEL[target.role] }} · @{{ target.username }}</text>

          <template v-if="canManage && target.role !== 'OWNER'">
            <view v-if="isOwner" class="sheet__action" @click="changeRole(target, 'ADMIN')">
              <text class="sheet__action-label">设为管理员</text>
            </view>
            <view class="sheet__action" @click="changeRole(target, 'MEMBER')">
              <text class="sheet__action-label">设为普通成员</text>
            </view>
            <view class="sheet__action" @click="resetPassword(target)">
              <text class="sheet__action-label">重置密码</text>
            </view>
            <view v-if="!isSelf(target)" class="sheet__action sheet__action--danger" @click="remove(target)">
              <text class="sheet__action-label">移出家庭</text>
            </view>
          </template>
          <text v-else-if="!canManage" class="sheet__hint">只有管理员能调整成员</text>

          <view class="sheet__action sheet__action--ghost" @click="target = null">
            <text class="sheet__action-label">关闭</text>
          </view>
        </view>
      </u-popup>

      <u-popup v-model="tempOpen" mode="center" border-radius="24">
        <view class="temp">
          <text class="temp__title">临时密码已生成</text>
          <text class="temp__value" @click="copyTemp">{{ tempPassword }}</text>
          <text class="temp__warn">请当面告知本人，这一串只显示这一次，关掉就看不到了。</text>
          <text class="temp__warn">对方下次登录会被强制要求修改密码。</text>
          <view class="temp__btn" @click="closeTemp"><text class="temp__btn-label">我记下了</text></view>
        </view>
      </u-popup>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 24rpx 32rpx 96rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.head__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.head__link,
.foot__label {
  font-size: 24rpx;
  color: var(--mb-color-primary);
}

.head__hint {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.page__error {
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.card {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.card__main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.card__name {
  font-size: 30rpx;
  color: var(--mb-color-text-primary);
}

.card__meta {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.card__role {
  font-size: 22rpx;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
  color: var(--mb-color-text-secondary);
}

.card__role--owner {
  background-color: var(--mb-color-primary-light);
  color: var(--mb-color-primary);
}

.foot {
  padding: 20rpx;
  text-align: center;
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

.sheet__subtitle,
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

.sheet__action--ghost {
  margin-top: 16rpx;
  border-bottom: none;
}

.sheet__action--ghost .sheet__action-label {
  color: var(--mb-color-text-disabled);
}

.temp {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  padding: 48rpx 40rpx;
  width: 620rpx;
}

.temp__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.temp__value {
  padding: 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  color: var(--mb-color-primary);
  font-size: 40rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
  text-align: center;
}

.temp__warn {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.temp__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.temp__btn-label {
  font-size: 28rpx;
  color: var(--mb-color-on-primary);
}
</style>
