<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { blockGuestDeepLink } from '../../guest/deep-link'
import { NOTE_MAX_LENGTH, type MemberDto } from '@moonbud/shared'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { membersApi, remindersApi } from '../../api/endpoints'
import { disarmReminder } from '../../notifications/local-notify'
import { resyncActiveReminderSchedules } from '../../notifications/reminder-arming'
import { buildRruleFromUi, parseRruleForUi, RRULE_PRESETS, type RruleKind } from '../../reminders/rrule-presets'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'
import { confirmDanger } from '../../utils/confirm'
import { isoFromWallTime, wallFields } from '../../utils/wall-time'
import { stepBack } from '../../utils/back-nav'

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

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')

// 表单上按的是钟点，预填就得按同一个时区的钟点读：跨时区设备上按设备本地预填，
// 一进来显示的是一个和账号无关的时刻，而写入又按时区解释它。
const initial = wallFields(timezone.value)
const date = ref(initial.date)
const time = ref(initial.time)

/**
 * 会话落定后补一次预填。直开深链接时 setup 里拿不到账号（tz 只能兜底），
 * 补之前先看用户动过没有——预填不该把已经按好的时间抹掉。
 */
function syncWallPrefill(): void {
  if (date.value !== initial.date || time.value !== initial.time) return
  const next = wallFields(timezone.value)
  date.value = next.date
  time.value = next.time
}

const preset = computed(() => RRULE_PRESETS.find((p) => p.key === presetKey.value) ?? RRULE_PRESETS[0])
const isEdit = computed(() => reminderId.value !== '')

/**
 * 类型在建好之后就不能再改了：后端的 UpdateReminderDto 刻意不收 `type`，而
 * ValidationPipe 是 whitelist 不 forbid —— 发过去的 `type` 会被静默丢掉。
 * 让开关照拨不误，用户看到"已保存"却什么都没变，所以在这里当场说清楚。
 */
function pickType(recurring: boolean): void {
  if (isEdit.value && recurring !== isRecurring.value) {
    uni.showToast({ title: '提醒类型改不了：请停掉这个提醒，再按新类型建一个', icon: 'none' })
    return
  }
  isRecurring.value = recurring
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
    // 一次性提醒也要带时区：dueAt 是按它算出来的，存下的 timezone 必须和算法一致，
    // 否则列表按旧的时区念一个新的时刻。
    const schedule = isRecurring.value
      ? { rrule: currentRrule(), timezone: timezone.value }
      : { dueAt: isoFromWallTime(timezone.value, date.value, time.value), timezone: timezone.value }
    const shared = {
      childId: childId.value || null,
      assigneeId: assigneeId.value || null,
      note: note.value.trim() || null,
    }
    const base = { title: title.value.trim(), ...schedule, ...shared }
    // 只有 POST 收 type：PATCH 发过去会被 whitelist 静默丢掉（见 pickType 的注释），
    // 写在这里只会让人以为改得动。
    if (reminderId.value) {
      await remindersApi.update(familyId.value, reminderId.value, base)
    } else {
      await remindersApi.create(familyId.value, {
        ...base,
        type: isRecurring.value ? 'RECURRING' : 'ONE_TIME',
      })
    }

    // 本地排期交给这一家的 ACTIVE 集合重算：新建/改完时间后，接下来几天的每次触发
    // 都要重新排上，而"这条还在不在待办里"只有服务端知道。
    await resyncActiveReminderSchedules()
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(() => stepBack(), 600)
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/**
 * 停掉 = status CANCELLED，后端同时把未发生的 occurrence 标成 SKIPPED。
 * 三个筛选栏（待办/已过期/已完成）都不含 CANCELLED，所以它从列表里彻底消失 ——
 * 确认框里必须把这件事说清楚，不然人会以为它只是暂时静音。
 */
async function cancelReminder(): Promise<void> {
  if (!reminderId.value || !familyId.value || saving.value) return
  const go = await confirmDanger({
    title: `停掉「${title.value.trim() || '这个提醒'}」？`,
    content: '停掉后它不会再提醒你，也不会再出现在提醒列表的任何一栏里。已经记下的内容不受影响；想再提醒只能重新建一个。',
    confirmText: '停掉提醒',
  })
  if (!go) return
  saving.value = true
  try {
    await remindersApi.cancel(familyId.value, reminderId.value)
    // 撤销排期不依赖网络：已经说了"别再响了"，就不能因为重算拉不到列表而继续响。
    disarmReminder(reminderId.value)
    uni.showToast({ title: '已停掉提醒', icon: 'none' })
    setTimeout(() => stepBack(), 600)
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '停掉失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

onLoad(async (query) => {
  if (await blockGuestDeepLink()) return
  // 时区是账号属性，而账号要等冷启动的静默登录才落到 store：直开深链接时先等它，
  // 否则预填按兜底时区算，用户看到一个和自己家无关的钟点。
  if (!authStore.user) await authStore.bootstrap()
  syncWallPrefill()
  await familyStore.load()
  if (!familyId.value) return
  await childStore.load(familyId.value)
  try {
    members.value = await membersApi.list(familyId.value)
  } catch {
    members.value = []
  }
  const id = String(query?.id ?? '')
  // 导航栏是 pages.json 里写死的"提醒"，编辑时不改口会让人以为在新增一条。
  uni.setNavigationBarTitle({ title: id ? '编辑提醒' : '新建提醒' })
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
      // 读回来也要按同一个时区念：用设备本地读会让"编辑—保存"每走一次就漂一格。
      const at = wallFields(timezone.value, new Date(reminder.dueAt))
      date.value = at.date
      time.value = at.time
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

const goBack = () => stepBack()
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
          <view class="chip" :class="{ 'chip--active': !isRecurring }" @click="pickType(false)">
            <text class="chip__label">一次性</text>
          </view>
          <view class="chip" :class="{ 'chip--active': isRecurring }" @click="pickType(true)">
            <text class="chip__label">重复</text>
          </view>
        </view>
        <text v-if="isEdit" class="field__hint">类型建好之后就不能改了。想换成另一种，请停掉这个提醒再建一个。</text>
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

      <view v-if="reminderId" class="cancel-link" :class="{ 'btn--disabled': saving }" @click="cancelReminder">
        <text class="cancel-link__label">停掉这个提醒</text>
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
  border-radius: 16rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
  width: 100%;
  box-sizing: border-box;
}

/* uni-app 把 uni-input 宿主定成 height:1.4em + overflow:hidden：宿主上的上下 padding
   会把真正可输入的 inner input 挤成约 1px，打进去的字被裁掉。高度归宿主，padding 只留左右。 */
.field__input {
  height: 80rpx;
  padding: 0 22rpx;
}

.field__textarea {
  padding: 18rpx 22rpx;
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

.cancel-link {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72rpx;
}

.cancel-link__label {
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-text-primary);
}
</style>
