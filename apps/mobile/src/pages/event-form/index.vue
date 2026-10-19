<script setup lang="ts">
import {
  EVENT_TYPES,
  isEventType,
  NOTE_MAX_LENGTH,
  validateEventPayload,
  validateNote,
  type EventType,
} from '@moonbud/shared'
import { onLoad } from '@dcloudio/uni-app'
import { computed, reactive, ref } from 'vue'
import { eventsApi } from '../../api/endpoints'
import { EVENT_TYPE_META, fieldsFor, NON_BLOCKING_NOTICES, type FieldSpec } from '../../events/event-fields'
import { eventToFormState, takeForEdit } from '../../events/event-edit'
import { shouldWarnDuplicate } from '../../events/duplicate-warning'
import { zhValidationMessage } from '../../events/validation-messages'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'

const familyStore = useFamilyStore()
const childStore = useChildStore()

const type = ref<EventType | ''>('')
const editingId = ref('')
const editingChildId = ref('')
const values = reactive<Record<string, string>>({})
const errors = reactive<Record<string, string>>({})
const note = ref('')
const duplicateHint = ref('')
const saving = ref(false)

const today = new Date()
const date = ref(fmt(today, 'date'))
const time = ref(fmt(today, 'time'))
const endDate = ref('')
const endTime = ref('')

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const child = computed(() => childStore.currentChild(familyId.value))
const fields = computed<FieldSpec[]>(() => (type.value ? fieldsFor(type.value) : []))
const meta = computed(() => (type.value ? EVENT_TYPE_META[type.value] : null))
/** 只有睡眠需要"结束时间"，其它类型的时长写在 payload 里。 */
const needsEnd = computed(() => type.value === 'sleep')

const targetChildName = computed(() => {
  if (!editingId.value) return child.value ? child.value.name : '未选择孩子'
  const found = (childStore.childrenByFamily[familyId.value] ?? []).find(
    (c) => c.id === editingChildId.value,
  )
  return found ? found.name : '（这条记录的孩子不在当前家庭里）'
})

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

function resetForm(): void {
  for (const key of Object.keys(values)) delete values[key]
  for (const key of Object.keys(errors)) delete errors[key]
  note.value = ''
  duplicateHint.value = ''
  endDate.value = ''
  endTime.value = ''
}

/**
 * 防重复提示必须不阻塞：这条请求失败（离线、401、慢）时表单照常可填。
 * 提示是锦上添花，把"记不下来"当成它的代价就本末倒置了。
 */
async function loadDuplicateHint(next: EventType): Promise<void> {
  if (!familyId.value || !child.value) return
  try {
    const latest = await eventsApi.latest(familyId.value, child.value.id, next)
    const hint = shouldWarnDuplicate({ latest: latest.event, type: next })
    duplicateHint.value = hint.warn ? hint.message : ''
  } catch {
    duplicateHint.value = ''
  }
}

function chooseType(next: EventType): void {
  type.value = next
  resetForm()
  void loadDuplicateHint(next)
}

/** 换类型回到宫格，不额外占一步：类型选择始终在同一屏内。 */
function backToGrid(): void {
  type.value = ''
  resetForm()
}

onLoad(async (query) => {
  await familyStore.load()
  if (familyId.value) await childStore.load(familyId.value)
  const requested = String(query?.type ?? '')
  const id = String(query?.id ?? '')
  if (id) {
    // 列表页把整条记录交接过来（后端没有 GET /events/:id）。取不到就是交接丢了，
    // 宁可退回新建，也不给一张空白表单让人"改了个不存在的东西"。
    const target = takeForEdit(id)
    if (!target) {
      uni.showToast({ title: '没拿到那条记录，请从列表再点一次', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 900)
      return
    }
    editingId.value = target.id
    editingChildId.value = target.childId
    type.value = target.type
    const state = eventToFormState(target)
    for (const [key, value] of Object.entries(state.values)) values[key] = value
    note.value = state.note
    date.value = state.date
    time.value = state.time
    endDate.value = state.endDate
    endTime.value = state.endTime
    return
  }
  if (isEventType(requested)) chooseType(requested)
})

function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields.value) {
    const raw = (values[field.name] ?? '').trim()
    if (!raw) continue
    if (field.kind === 'number') {
      const asNumber = Number(raw)
      // 非数字要在这里就报错：交给 zod 只会得到一句 "Expected number"，没人看得懂。
      if (!Number.isFinite(asNumber)) {
        errors[field.name] = `${field.label}请填写数字`
        continue
      }
      payload[field.name] = asNumber
    } else {
      payload[field.name] = raw
    }
  }
  return payload
}

function assignErrors(messages: string[]): void {
  for (const key of Object.keys(errors)) delete errors[key]
  for (const message of messages) {
    const [path, ...rest] = message.split(': ')
    const text = zhValidationMessage(rest.join(': ') || message)
    if (path && path !== '(root)') errors[path] = text
    else errors.form = text
  }
}

async function onSubmit(): Promise<void> {
  if (saving.value || !type.value) return
  // 编辑走记录自己挂的孩子；"当前孩子"是记录页的筛选口径，拿它覆盖会顺手把孩子改掉。
  const childId = editingId.value ? editingChildId.value : child.value?.id ?? ''
  if (!familyId.value || !childId) {
    uni.showToast({ title: '请先创建家庭并添加孩子', icon: 'none' })
    return
  }
  const payload = buildPayload()
  const result = validateEventPayload(type.value, payload)
  if (!result.ok) {
    assignErrors(result.errors)
    return
  }
  const noteResult = validateNote(note.value.trim() || undefined)
  if (noteResult && !noteResult.ok) {
    assignErrors(noteResult.errors)
    return
  }

  saving.value = true
  const body = {
    childId,
    type: type.value,
    occurredAt: localIso(date.value, time.value),
    endedAt: needsEnd.value && endDate.value ? localIso(endDate.value, endTime.value || '00:00') : null,
    payload: result.data,
    note: note.value.trim() || null,
  }
  try {
    if (editingId.value) {
      await eventsApi.update(familyId.value, editingId.value, body)
      uni.showToast({ title: '已更新', icon: 'none' })
    } else {
      await eventsApi.create(familyId.value, body)
      uni.showToast({ title: '已记录', icon: 'none' })
    }
    setTimeout(() => uni.navigateBack(), 600)
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

const goBack = () => uni.navigateBack()
</script>

<template>
  <theme-root>
    <view class="form">
      <view v-if="!type" class="form__grid">
        <text class="form__title">记什么</text>
        <view class="grid">
          <view v-for="t in EVENT_TYPES" :key="t" class="grid__cell" @click="chooseType(t)">
            <text class="grid__icon">{{ EVENT_TYPE_META[t].icon }}</text>
            <text class="grid__label">{{ EVENT_TYPE_META[t].label }}</text>
          </view>
        </view>
      </view>

      <view v-else class="form__fields">
        <view class="form__head">
          <text class="form__title">{{ editingId ? '编辑' : meta!.icon + ' ' + meta!.label }}</text>
          <text v-if="!editingId" class="form__switch" @click="backToGrid">换一种</text>
        </view>
        <!-- 记在哪个孩子身上必须写在脸上：切换家庭后填错孩子，事后连错在哪都不知道。 -->
        <text class="form__child">记录对象：{{ targetChildName }}</text>

        <view v-if="duplicateHint && !editingId" class="hint">
          <text class="hint__text">{{ duplicateHint }}，确定要再记一次吗？</text>
        </view>
        <view v-if="NON_BLOCKING_NOTICES[type]" class="hint hint--soft">
          <text class="hint__text">{{ NON_BLOCKING_NOTICES[type] }}</text>
        </view>
        <text v-if="errors.form" class="form__error">{{ errors.form }}</text>

        <view class="field">
          <text class="field__label">发生时间 *</text>
          <view class="field__row">
            <picker mode="date" :value="date" @change="date = $event.detail.value">
              <text class="picker">{{ date }}</text>
            </picker>
            <picker mode="time" :value="time" @change="time = $event.detail.value">
              <text class="picker">{{ time }}</text>
            </picker>
          </view>
        </view>

        <view v-if="needsEnd" class="field">
          <text class="field__label">结束时间</text>
          <view class="field__row">
            <picker mode="date" :value="endDate || date" @change="endDate = $event.detail.value">
              <text class="picker">{{ endDate || '未设置' }}</text>
            </picker>
            <picker mode="time" :value="endTime" @change="endTime = $event.detail.value">
              <text class="picker">{{ endTime || '未设置' }}</text>
            </picker>
          </view>
        </view>

        <view v-for="field in fields" :key="field.name" class="field">
          <text class="field__label">
            {{ field.label }}
            <text v-if="field.required" class="field__star">*</text>
            <text v-if="field.unit" class="field__unit">（{{ field.unit }}）</text>
          </text>

          <view v-if="field.kind === 'select'" class="field__row">
            <view
              v-for="option in field.options"
              :key="option.value"
              class="chip"
              :class="{ 'chip--active': values[field.name] === option.value }"
              @click="values[field.name] = option.value"
            >
              <text class="chip__label">{{ option.label }}</text>
            </view>
          </view>

          <textarea
            v-else-if="field.kind === 'textarea'"
            v-model="values[field.name]"
            class="field__textarea"
            :placeholder="field.placeholder"
            :maxlength="200"
          />

          <input
            v-else
            v-model="values[field.name]"
            class="field__input"
            :type="field.kind === 'number' ? 'digit' : 'text'"
            :placeholder="field.placeholder"
          />

          <text v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</text>
        </view>

        <view class="field">
          <text class="field__label">备注</text>
          <textarea v-model="note" class="field__textarea" :maxlength="NOTE_MAX_LENGTH" placeholder="可选" />
        </view>

        <view class="form__actions">
          <view class="btn" :class="{ 'btn--disabled': saving }" @click="onSubmit">
            <text class="btn__label">保存</text>
          </view>
          <view class="btn btn--ghost" @click="goBack"><text class="btn__label">取消</text></view>
        </view>
      </view>
    </view>
  </theme-root>
</template>

<style scoped>
.form {
  padding: 32rpx 40rpx 96rpx;
}

.form__title {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.form__head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.form__switch {
  font-size: 26rpx;
  color: var(--mb-color-primary);
}

.form__child {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 24rpx;
}

.grid__cell {
  width: 25%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  padding: 28rpx 0;
}

.grid__icon {
  font-size: 48rpx;
}

.grid__label {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.form__fields {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  margin-top: 8rpx;
}

.hint {
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  border-left: 6rpx solid var(--mb-color-warning);
}

.hint--soft {
  border-left-color: var(--mb-color-info);
}

.hint__text {
  font-size: 24rpx;
  line-height: 1.6;
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

.field__star {
  color: var(--mb-color-error);
}

.field__unit {
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

.form__error {
  font-size: 24rpx;
  color: var(--mb-color-error);
}

.picker {
  padding: 16rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
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

.form__actions {
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
