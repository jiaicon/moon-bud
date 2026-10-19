<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { computeDueAt, NOTE_MAX_LENGTH, type MemberDto } from '@moonbud/shared'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { membersApi, remindersApi } from '../../api/endpoints'
import { scheduleLocalNotification } from '../../notifications/local-notify'
import { buildRruleFromUi, parseRruleForUi, RRULE_PRESETS, type RruleKind } from '../../reminders/rrule-presets'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const childStore = useChildStore()

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const CUSTOM_KINDS: { value: RruleKind; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'everyNDays', label: '每隔 N 天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

const reminderId = ref('')
const title = ref('')
const note = ref('')
const isRecurring = ref(false)
const presetKey = ref('daily')
const customKind = ref<RruleKind>('everyNDays')
const everyN = ref('2')
const weekday = ref(0)
const childId = ref('')
const assigneeId = ref('')
const errors = reactive<Record<string, string>>({})
const saving = ref(false)
const members = ref<MemberDto[]>([])

const now = new Date()
const date = ref(fmt(now, 'date'))
const time = ref(fmt(now, 'time'))

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')
const preset = computed(() => RRULE_PRESETS.find((p) => p.key === presetKey.value) ?? RRULE_PRESETS[0])

function fmt(d: Date, kind: 'date' | 'time'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return kind === 'date'
    ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}`
}

function localIso(day: string, minute: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = minute.split(':').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0).toISOString()
}

/** 自定义走拼装，预设直接用预设串：两条路都交给同一个校验口。 */
function currentRrule(): string {
  const [hh, mm] = time.value.split(':').map(Number)
  if (presetKey.value === 'custom') {
    return buildRruleFromUi({
      kind: customKind.value,
      hour: hh || 0,
      minute: mm || 0,
      n: Number(everyN.value) || 1,
      weekday: weekday.value,
    })
  }
  // 预设串的时间由用户在这个时刻覆盖：预设只是起点，不该把 08:00 强塞给用户。
  return buildRruleFromUi({
    kind: presetKey.value === 'every2days' ? 'everyNDays' : (presetKey.value as RruleKind),
    hour: hh || 0,
    minute: mm || 0,
    n: 2,
    weekday: presetKey.value === 'weekly' ? weekday.value : undefined,
  })
}

function validate(): boolean {
  for (const key of Object.keys(errors)) delete errors[key]
  const trimmed = title.value.trim()
  if (!trimmed) errors.title = '请输入提醒标题'
  else if (trimmed.length > 50) errors.title = '标题不超过 50 字'
  if (note.value.length > NOTE_MAX_LENGTH) errors.note = `备注不能超过 ${NOTE_MAX_LENGTH} 字`
  if (isRecurring.value) {
    try {
      currentRrule()
    } catch (err) {
      errors.rrule = err instanceof Error ? err.message : '重复规则不完整'
    }
  }
  return Object.keys(errors).length === 0
}

async function onSubmit(): Promise<void> {
  if (saving.value || !familyId.value) return
  if (!validate()) return
  saving.value = true
  try {
    const payload = isRecurring.value
      ? { title: title.value.trim(), type: 'RECURRING' as const, rrule: currentRrule(), timezone: timezone.value }
      : { title: title.value.trim(), type: 'ONE_TIME' as const, dueAt: localIso(date.value, time.value) }
    const shared = {
      childId: childId.value || null,
      assigneeId: assigneeId.value || null,
      note: note.value.trim() || null,
    }
    const saved = reminderId.value
      ? await remindersApi.update(familyId.value, reminderId.value, { ...payload, ...shared })
      : await remindersApi.create(familyId.value, { ...payload, ...shared })

    // 本地排期只在 APP 端真实存在；其它平台里这个调用会显式警告，不弹窗打扰。
    const next = computeDueAt({
      type: saved.type,
      dueAt: saved.dueAt ? new Date(saved.dueAt) : null,
      rrule: saved.rrule,
      timezone: saved.timezone,
      after: new Date(),
    })
    if (next) {
      scheduleLocalNotification({ id: saved.id, title: saved.title, body: whoLabel(saved.assigneeId), at: next })
    }
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function whoLabel(assignee: string | null): string {
  if (!assignee) return '全家'
  const member = members.value.find((m) => m.userId === assignee)
  return member?.displayName || member?.nickname || '家人'
}

onLoad(async (query) => {
  await familyStore.load()
  if (!familyId.value) return
  await childStore.load(familyId.value)
  try {
    members.value = await membersApi.list(familyId.value)
  } catch {
    members.value = []
  }
  const id = String(query?.id ?? '')
  if (!id) return
  reminderId.value = id
  try {
    const reminder = await remindersApi.get(familyId.value, id)
    title.value = reminder.title
    note.value = reminder.note ?? ''
    childId.value = reminder.childId ?? ''
    assigneeId.value = reminder.assigneeId ?? ''
    isRecurring.value = reminder.type === 'RECURRING'
    if (reminder.dueAt) {
      const at = new Date(reminder.dueAt)
      date.value = fmt(at, 'date')
      time.value = fmt(at, 'time')
    }
    if (reminder.rrule) {
      const parsed = parseRruleForUi(reminder.rrule)
      if (parsed) {
        presetKey.value = parsed.key
        customKind.value = parsed.kind
        everyN.value = String(parsed.n ?? 2)
        weekday.value = parsed.weekday ?? 0
        time.value = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
      }
    }
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '提醒加载失败', icon: 'none' })
  }
})

const goBack = () => uni.navigateBack()
</script>

<template>
  <theme-root>
    <view class="page">
      <text class="page__title">{{ reminderId ? '编辑提醒' : '新建提醒' }}</text>

      <view class="field">
        <text class="field__label">标题 *</text>
        <input v-model="title" class="field__input" maxlength="50" placeholder="如：补维生素 D" />
        <text v-if="errors.title" class="field__error">{{ errors.title }}</text>
      </view>

      <view class="field">
        <text class="field__label">关联孩子</text>
        <view class="field__row">
          <view class="chip" :class="{ 'chip--active': childId === '' }" @click="childId = ''">
            <text class="chip__label">不挂孩子</text>
          </view>
          <view v-for="child in children" :key="child.id" class="chip" :class="{ 'chip--active': childId === child.id }" @click="childId = child.id">
            <text class="chip__label">{{ child.name }}</text>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field__label">类型</text>
        <view class="field__row">
          <view class="chip" :class="{ 'chip--active': !isRecurring }" @click="isRecurring = false">
            <text class="chip__label">一次性</text>
          </view>
          <view class="chip" :class="{ 'chip--active': isRecurring }" @click="isRecurring = true">
            <text class="chip__label">重复</text>
          </view>
        </view>
      </view>

      <view v-if="!isRecurring" class="field">
        <text class="field__label">提醒时间 *</text>
        <view class="field__row">
          <picker mode="date" :value="date" @change="date = $event.detail.value">
            <text class="picker">{{ date }}</text>
          </picker>
          <picker mode="time" :value="time" @change="time = $event.detail.value">
            <text class="picker">{{ time }}</text>
          </picker>
        </view>
      </view>

      <template v-else>
        <view class="field">
          <text class="field__label">重复</text>
          <view class="field__row">
            <view v-for="p in RRULE_PRESETS" :key="p.key" class="chip" :class="{ 'chip--active': presetKey === p.key }" @click="presetKey = p.key">
              <text class="chip__label">{{ p.label }}</text>
            </view>
          </view>
          <text class="field__hint">{{ preset.preview(timezone) }}</text>
        </view>

        <view v-if="presetKey === 'custom'" class="field">
          <text class="field__label">频率</text>
          <view class="field__row">
            <view v-for="k in CUSTOM_KINDS" :key="k.value" class="chip" :class="{ 'chip--active': customKind === k.value }" @click="customKind = k.value">
              <text class="chip__label">{{ k.label }}</text>
            </view>
          </view>
          <input v-if="customKind === 'everyNDays'" v-model="everyN" class="field__input" type="digit" placeholder="每隔几天，如 2" />
          <view v-if="customKind === 'weekly'" class="field__row">
            <view v-for="(label, index) in WEEKDAYS" :key="label" class="chip" :class="{ 'chip--active': weekday === index }" @click="weekday = index">
              <text class="chip__label">{{ label }}</text>
            </view>
          </view>
        </view>

        <view class="field">
          <text class="field__label">每天几点 *</text>
          <view class="field__row">
            <picker mode="time" :value="time" @change="time = $event.detail.value">
              <text class="picker">{{ time }}</text>
            </picker>
          </view>
        </view>
      </template>

      <view class="field">
        <text class="field__label">执行人</text>
        <view class="field__row">
          <view class="chip" :class="{ 'chip--active': assigneeId === '' }" @click="assigneeId = ''">
            <text class="chip__label">全家</text>
          </view>
          <view v-for="member in members" :key="member.userId" class="chip" :class="{ 'chip--active': assigneeId === member.userId }" @click="assigneeId = member.userId">
            <text class="chip__label">{{ member.displayName || member.nickname }}</text>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field__label">备注</text>
        <textarea v-model="note" class="field__textarea" :maxlength="NOTE_MAX_LENGTH" placeholder="可选" />
        <text v-if="errors.note" class="field__error">{{ errors.note }}</text>
      </view>

      <text v-if="errors.rrule" class="field__error">{{ errors.rrule }}</text>

      <view class="actions">
        <view class="btn" :class="{ 'btn--disabled': saving }" @click="onSubmit"><text class="btn__label">保存</text></view>
        <view class="btn btn--ghost" @click="goBack"><text class="btn__label">取消</text></view>
      </view>
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

.page__title {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
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

.field__hint {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.field__row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
  align-items: center;
}

.field__input,
.field__textarea {
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
  width: 100%;
  box-sizing: border-box;
}

.field__textarea {
  height: 140rpx;
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
  padding: 16rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
}

.actions {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-top: 16rpx;
}

.btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--ghost {
  background-color: var(--mb-color-surface-alt);
}

.btn--disabled {
  opacity: 0.5;
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-text-primary);
}
</style>
