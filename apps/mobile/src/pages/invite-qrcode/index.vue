<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import QRCode from 'qrcode'
import { computed, ref } from 'vue'
import { invitesApi } from '../../api/endpoints'
import { INVITE_LANDING_BASE_URL } from '../../config/env'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { joinPageUrl } from '../../invite/landing-url'
import { useFamilyStore } from '../../stores/family'
import type { FamilyRole, InviteDto, InviteRole } from '@moonbud/shared'

const ROLES: { value: InviteRole; label: string }[] = [
  { value: 'MEMBER', label: '普通成员' },
  { value: 'ADMIN', label: '管理员' },
]
// 接口的入参只允许 ADMIN/MEMBER，但返回类型按 FamilyRole 给，
// 所以这张表必须覆盖 OWNER，否则模板里的索引表达式不合法。
const ROLE_LABEL: Record<FamilyRole, string> = { OWNER: '创建者', ADMIN: '管理员', MEMBER: '普通成员' }

const familyStore = useFamilyStore()

const invites = ref<InviteDto[]>([])
const role = ref<InviteRole>('MEMBER')
const hours = ref('72')
const busy = ref(false)
const error = ref<string | null>(null)
const active = ref<InviteDto | null>(null)

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const landingUrl = computed(() => joinPageUrl(INVITE_LANDING_BASE_URL, active.value?.code ?? ''))
/** 发码/撤销后端只认 OWNER/ADMIN（列表任何成员都能看），普通成员来了只给看不给点。 */
const canManage = computed(() => {
  const role = familyStore.currentFamily?.role
  return role === 'OWNER' || role === 'ADMIN'
})

/**
 * 二维码跟着主题画是错的：深色模式里它是浅码深底，微信的解码器对这种反色码
 * 时灵时不灵，而"扫不出来"在家人那边等于这个功能没有。所以这一块固定黑码白底，
 * 卡片其余部分（标题、邀请码、说明）仍跟着主题。
 * 用 create() 拿模块矩阵自己铺 view，避免 qrcode 的 canvas 路径（APP 端没有 canvas）。
 */
const matrix = computed(() => {
  if (!landingUrl.value) return null
  try {
    const qr = QRCode.create(landingUrl.value, { errorCorrectionLevel: 'M' })
    const size = qr.modules.size
    const data = qr.modules.data
    const rows: boolean[][] = []
    for (let y = 0; y < size; y++) {
      const row: boolean[] = []
      for (let x = 0; x < size; x++) row.push(!!data[y * size + x])
      rows.push(row)
    }
    return rows
  } catch {
    return null
  }
})

async function loadInvites(): Promise<void> {
  if (!familyId.value) return
  try {
    invites.value = await invitesApi.list(familyId.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '邀请列表加载失败'
  }
}

async function create(): Promise<void> {
  if (!familyId.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    // 邀请码可被反复试错，因此默认限制次数与时长，而不是发一张长期有效的通行证。
    const invite = await invitesApi.create(familyId.value, role.value, Number(hours) || 72, 20)
    active.value = invite
    await loadInvites()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '生成邀请失败'
  } finally {
    busy.value = false
  }
}

async function revoke(invite: InviteDto): Promise<void> {
  try {
    await invitesApi.revoke(familyId.value, invite.id)
    if (active.value?.id === invite.id) active.value = null
    uni.showToast({ title: '已撤销', icon: 'none' })
    await loadInvites()
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '撤销失败', icon: 'none' })
  }
}

function pick(invite: InviteDto): void {
  active.value = invite
}

function copyCode(): void {
  if (!active.value) return
  uni.setClipboardData({ data: active.value.code })
}

function remaining(invite: InviteDto): string {
  if (invite.revokedAt) return '已撤销'
  const left = invite.maxUses - invite.usedCount
  const until = new Date(invite.expiresAt)
  const expired = !Number.isNaN(until.getTime()) && until.getTime() < Date.now()
  if (expired) return '已过期'
  if (left <= 0) return '用完了'
  return `剩 ${left} 次`
}

onLoad(async () => {
  await familyStore.load()
  await loadInvites()
})
</script>

<template>
  <theme-root>
    <view class="page">
      <view v-if="!familyId" class="notice">
        <text class="notice__text">还没有家庭，先创建一个才能邀请家人。</text>
      </view>

      <template v-else>
        <template v-if="canManage">
          <view class="field">
            <text class="field__label">加入后的身份</text>
            <view class="chip-row">
              <view v-for="r in ROLES" :key="r.value" class="chip" :class="{ 'chip--active': role === r.value }" @click="role = r.value">
                <text class="chip__label">{{ r.label }}</text>
              </view>
            </view>
          </view>

          <view class="field">
            <text class="field__label">有效小时数</text>
            <input v-model="hours" class="field__input" type="digit" placeholder="默认 72 小时" />
          </view>

          <view class="btn" :class="{ 'btn--disabled': busy }" @click="create">
            <text class="btn__label">{{ busy ? '生成中…' : '生成邀请码' }}</text>
          </view>
        </template>
        <text v-else class="page__readonly-hint">只有管理员能生成或撤销邀请码。下面的码可以看、可以扫。</text>

        <text v-if="error" class="page__error">{{ error }}</text>

        <view v-if="active" class="code-card">
          <text class="code-card__label">邀请码</text>
          <text class="code-card__value" @click="copyCode">{{ active.code }}</text>
          <text class="code-card__hint">让家人在「加入家庭」里输入这串码即可</text>

          <view v-if="matrix" class="qr">
            <view v-for="(row, yi) in matrix" :key="yi" class="qr__row">
              <view
                v-for="(dark, xi) in row"
                :key="xi"
                class="qr__cell"
                :class="dark ? 'qr__cell--dark' : 'qr__cell--light'"
              />
            </view>
          </view>
          <template v-else>
            <view v-if="landingUrl" class="qr-fallback"><text class="qr-fallback__text">二维码生成失败，请用邀请码</text></view>
            <view v-else class="qr-fallback">
              <text class="qr-fallback__text">扫码需要先在 .env 里配置 VITE_INVITE_BASE_URL；当前只能用上面的邀请码</text>
            </view>
          </template>
        </view>

        <view v-if="invites.length" class="list">
          <text class="list__title">当前邀请</text>
          <view v-for="invite in invites" :key="invite.id" class="row" @click="pick(invite)">
            <view class="row__main">
              <text class="row__code">{{ invite.code }}</text>
              <text class="row__meta">{{ ROLE_LABEL[invite.role] }} · {{ remaining(invite) }}</text>
            </view>
            <view v-if="canManage && !invite.revokedAt" class="row__revoke" @click.stop="revoke(invite)">
              <text class="row__revoke-label">撤销</text>
            </view>
          </view>
        </view>
      </template>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 32rpx 40rpx 96rpx;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
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
  height: 76rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface);
  color: var(--mb-color-text-primary);
  font-size: 28rpx;
}

.chip-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
}

.chip {
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.chip--active {
  background-color: var(--mb-color-primary);
}

.chip__label {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.chip--active .chip__label {
  color: var(--mb-color-on-primary);
}

.page__error {
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.page__readonly-hint {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.code-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 40rpx 24rpx;
  border-radius: 24rpx;
  background-color: var(--mb-color-surface);
}

.code-card__label {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.code-card__value {
  font-size: 56rpx;
  font-weight: 700;
  letter-spacing: 6rpx;
  color: var(--mb-color-primary);
}

.code-card__hint {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.qr {
  display: flex;
  flex-direction: column;
  padding: 16rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--mb-color-border);
  /* 这一块是整套主题里唯一不许跟着变色的地方，见 matrix 上方的注释 */
  background-color: #ffffff;
}

.qr__row {
  display: flex;
  flex-direction: row;
}

.qr__cell {
  width: 12rpx;
  height: 12rpx;
}

.qr__cell--dark {
  background-color: #000000;
}

.qr__cell--light {
  background-color: #ffffff;
}

.qr-fallback {
  padding: 20rpx;
}

.qr-fallback__text {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
  text-align: center;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.list__title {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  background-color: var(--mb-color-surface);
}

.row__main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.row__code {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.row__meta {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.row__revoke {
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.row__revoke-label {
  font-size: 22rpx;
  color: var(--mb-color-error);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--disabled {
  background-color: var(--mb-color-surface-alt);
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}
</style>
