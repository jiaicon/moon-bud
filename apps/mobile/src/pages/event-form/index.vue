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
import { blockGuestDeepLink } from '../../guest/deep-link'
import { askBannerCopy } from '../../assistant/ask-flow'
import { takeEventDraft } from '../../assistant/draft-handoff'
import { computed, reactive, ref } from 'vue'
import { eventsApi } from '../../api/endpoints'
import { EVENT_TYPE_META, fieldsFor, NON_BLOCKING_NOTICES, type FieldSpec } from '../../events/event-fields'
import { eventToFormState, takeForEdit } from '../../events/event-edit'
import { shouldWarnDuplicate } from '../../events/duplicate-warning'
import { zhValidationMessage } from '../../events/validation-messages'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useDupWindowStore } from '../../stores/dup-window'
import { useFamilyStore } from '../../stores/family'
import { useOutboxStore } from '../../stores/outbox'
import { isoFromWallTime, wallFields } from '../../utils/wall-time'
import { stepBack } from '../../utils/back-nav'

const familyStore = useFamilyStore()
const childStore = useChildStore()
const authStore = useAuthStore()
const dupWindowStore = useDupWindowStore()
const outboxStore = useOutboxStore()

const type = ref<EventType | ''>('')
const editingId = ref('')
/**
 * 这一笔挂在哪个孩子身上：编辑时来自那条记录，从通知「去记一笔」进来时来自那条通知。
 * 它和记录页那个"当前孩子"是两件事——拿后者当默认值，等于替人决定记在谁身上。
 */
const targetChildId = ref('')
/** 这一笔是哪条提醒叫起来的；手记的那一笔没有出处。 */
const fromReminderId = ref<string | null>(null)
const values = reactive<Record<string, string>>({})
const errors = reactive<Record<string, string>>({})
const note = ref('')
const duplicateHint = ref('')
const askBanner = ref<string | null>(null)
const saving = ref(false)

const familyId = computed(() => familyStore.currentFamilyId ?? '')
/**
 * 记录的时间按账号时区解释：列表里的"今天/昨天"和钟点都按它念（见 events/summary.ts），
 * 写入若按设备本地换时刻，跨时区的设备上就会存进一个和所填钟点不符的时刻，
 * 而且每次编辑再存都会把它按时区差推远一格。
 */
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')

// 预填也按同一个时区读"现在"，否则表单显示的是设备钟点、解释的却是账号钟点。
const initial = wallFields(timezone.value)
const date = ref(initial.date)
const time = ref(initial.time)
const endDate = ref('')
const endTime = ref('')

/**
 * 会话落定后补一次预填。直开深链接时 setup 里拿不到账号（时区只能兜底），
 * 补之前先看用户动过没有——预填不该把已经按好的时间抹掉。
 */
function syncWallPrefill(): void {
  if (date.value !== initial.date || time.value !== initial.time) return
  const next = wallFields(timezone.value)
  date.value = next.date
  time.value = next.time
}

const child = computed(() => childStore.currentChild(familyId.value))
/** 钉住的那个孩子在当前缓存里叫什么；查不到就是 null，界面得说实话而不能换个孩子。 */
const pinnedChild = computed(
  () => (childStore.childrenByFamily[familyId.value] ?? []).find((c) => c.id === targetChildId.value) ?? null,
)
const fields = computed<FieldSpec[]>(() => (type.value ? fieldsFor(type.value) : []))
const meta = computed(() => (type.value ? EVENT_TYPE_META[type.value] : null))
/** 只有睡眠需要"结束时间"，其它类型的时长写在 payload 里。 */
const needsEnd = computed(() => type.value === 'sleep')
/**
 * 结束日期与钟点只选了其中一个。另一端没法凭空补：补 00:00 会造出一段
 * 倒着走的睡眠，按发生日期补等于替用户编了一个他没选过的值。
 */
const halfFilledEnd = computed(
  () => needsEnd.value && Boolean(endDate.value) !== Boolean(endTime.value),
)

const targetChildName = computed(() => {
  if (targetChildId.value) {
    // 归档的孩子（客户端根本拿不到）或者别的一家的孩子：照原样记下去，让服务端的
    // 400 说实话，不能悄悄换成"当前孩子"——那等于把这一笔记到了另一个孩子身上。
    return pinnedChild.value ? pinnedChild.value.name : '（这条记录的孩子不在当前家庭里）'
  }
  return child.value ? child.value.name : '未选择孩子'
})

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
  // 提示要按这一笔真正落到的那个孩子查，不是记录页选中的那个。
  const target = targetChildId.value ? pinnedChild.value : child.value
  if (!familyId.value || !target) return
  try {
    const latest = await eventsApi.latest(familyId.value, target.id, next)
    const hint = shouldWarnDuplicate({
      latest: latest.event,
      type: next,
      timezone: timezone.value,
      windowMinutes: dupWindowStore.windowFor(next),
    })
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
  if (await blockGuestDeepLink()) return
  // 记录的起止钟点按账号时区解释，而账号是冷启动静默登录才落到 store 的：
  // 直开深链接时先等它，不然预填出来的是兜底时区的钟点。
  if (!authStore.user) await authStore.bootstrap()
  syncWallPrefill()
  // 通知上的「去记一笔」带着它自己的家庭、孩子和提醒（见 notifications/quick-record.ts）。
  // 不先切到那一家、不把这一笔钉在那个孩子上，它就会记进当前家庭、当前孩子身上——
  // 人明明是从另一个孩子的提醒点进来的。手记的那一路没有这些参数，照常按当前走。
  const fromFamily = String(query?.familyId ?? '')
  if (fromFamily && fromFamily !== familyStore.currentFamilyId) familyStore.switchFamily(fromFamily)
  await familyStore.load()
  if (familyId.value) await childStore.load(familyId.value)
  targetChildId.value = String(query?.childId ?? '')
  fromReminderId.value = String(query?.reminderId ?? '') || null
  const requested = String(query?.type ?? '')
  const id = String(query?.id ?? '')
  // 导航栏是 pages.json 里写死的"记一笔"，编辑时不改口会让人以为在新增一条。
  uni.setNavigationBarTitle({ title: id ? '编辑记录' : '记一笔' })
  if (id) {
    // 列表页把整条记录交接过来（后端没有 GET /events/:id）。取不到就是交接丢了，
    // 宁可退回新建，也不给一张空白表单让人"改了个不存在的东西"。
    const target = takeForEdit(id)
    if (!target) {
      uni.showToast({ title: '没拿到那条记录，请从列表再点一次', icon: 'none' })
      setTimeout(() => stepBack(), 900)
      return
    }
    editingId.value = target.id
    targetChildId.value = target.childId
    type.value = target.type
    const state = eventToFormState(target, timezone.value)
    for (const [key, value] of Object.entries(state.values)) values[key] = value
    note.value = state.note
    date.value = state.date
    time.value = state.time
    endDate.value = state.endDate
    endTime.value = state.endTime
    return
  }
  // ---- 助手预填：「说一句话」换成的那份草稿 ----
  // 草稿不走 url：App 端 navigateTo 会把 query 的值再编码一遍，中文到手机上就是 %E5%AE%9D…
  // （见 assistant/draft-handoff.ts）。取一次就没了，编辑那一路在上面已经 return，碰不到它。
  const asked = takeEventDraft()
  if (asked?.childId) targetChildId.value = asked.childId
  // 类型要在选下去之前定好：宫格、要显示哪些栏、防重复提示都按它算。
  const nextType = asked ? asked.event.type : requested
  if (isEventType(nextType)) chooseType(nextType)

  if (asked) {
    askBanner.value = askBannerCopy(asked.dropped)
    // 格式不对就当没带。脏串塞进日期/时间选择器只会显示成空的或乱的，比不填更骗人。
    const [prefillDate = '', prefillTime = ''] = (asked.event.occurredAtWallClock ?? '').split('T')
    if (/^\d{4}-\d{2}-\d{2}$/.test(prefillDate)) date.value = prefillDate
    if (/^\d{2}:\d{2}$/.test(prefillTime)) time.value = prefillTime

    const rawPayload = asked.event.payload
    if (rawPayload && Object.keys(rawPayload).length > 0) {
      // 只回填界面上有的栏（fields 是选了类型才有的 computed）。模型说了一栏
      // 界面没有的东西，给人看一个填不进去、又不会被提交的值，比不说更糟。
      for (const field of fields.value) {
        const value = rawPayload[field.name]
        if (typeof value === 'string' || typeof value === 'number') {
          values[field.name] = String(value)
        }
      }
    }
  }
})

/**
 * 收表单为 payload。返回 null 表示有字段填得不像数字：这些值不能当成"没填"
 * 存下去——用户明明写了东西，存成缺字段就是把他记的东西扔掉。
 */
function buildPayload(): Record<string, unknown> | null {
  for (const key of Object.keys(errors)) delete errors[key]
  const payload: Record<string, unknown> = {}
  let blocked = false
  for (const field of fields.value) {
    const raw = (values[field.name] ?? '').trim()
    if (!raw) continue
    if (field.kind === 'number') {
      const asNumber = Number(raw)
      // 非数字要在这里就报错：交给 zod 只会得到一句 "Expected number"，没人看得懂。
      if (!Number.isFinite(asNumber)) {
        errors[field.name] = `${field.label}请填写数字`
        blocked = true
        continue
      }
      payload[field.name] = asNumber
    } else {
      payload[field.name] = raw
    }
  }
  return blocked ? null : payload
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
  // 编辑走记录自己挂的孩子，从通知跳来走通知那个孩子；"当前孩子"只是手记时的兜底。
  const childId = targetChildId.value || (child.value?.id ?? '')
  if (!familyId.value || !childId) {
    uni.showToast({ title: '请先创建家庭并添加孩子', icon: 'none' })
    return
  }
  const payload = buildPayload()
  if (!payload) return
  if (halfFilledEnd.value) {
    errors.end = '结束时间要把日期和钟点都选好，不然这段睡眠存不下'
    return
  }
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
  const shared = {
    type: type.value,
    occurredAt: isoFromWallTime(timezone.value, date.value, time.value),
    endedAt:
      needsEnd.value && endDate.value
        ? isoFromWallTime(timezone.value, endDate.value, endTime.value || '00:00')
        : null,
    payload: result.data,
    note: note.value.trim() || null,
  }
  try {
    if (editingId.value) {
      // PATCH 不收 childId：UpdateEventDto 里没有这个字段，whitelist 会静默丢掉它，
      // 发过去只会让"已更新"这句话撒一次谎。记录属于哪个孩子，打开编辑时就定死了。
      const res = await outboxStore.submitUpdate(familyId.value, editingId.value, shared)
      uni.showToast({ title: queuedToast(res, '已更新'), icon: 'none' })
    } else {
      // 出处只在创建这一路有得说：PATCH 不收 fromReminderId，发过去等于让"已更新"撒谎。
      const res = await outboxStore.submitCreate(familyId.value, {
        childId,
        fromReminderId: fromReminderId.value,
        ...shared,
      })
      uni.showToast({ title: queuedToast(res, '已记录'), icon: 'none' })
    }
    setTimeout(() => stepBack(), 600)
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/**
 * 离线时保存并没有真的存进服务端，界面绝不能说"已记录"——那会让人以为记好了、
 * 关掉手机就不再管。说清"先存本机、恢复网络自动上传"，才是这条记录真实的处境。
 */
function queuedToast(res: { kind: 'saved' | 'queued' }, savedCopy: string): string {
  return res.kind === 'queued' ? '已存到待同步，恢复网络后自动上传' : savedCopy
}

const goBack = () => stepBack()
</script>

<template>
  <theme-root>
    <view class="form">
      <!-- 这句话是助手唯一一次当着人的面开口：它得说清这份草稿是从"你刚说的那一句"来的，
           并且把没填上的栏一起说了——格子还空着时不许报喜。 -->
      <view v-if="askBanner" class="ask-banner">
        <text class="ask-banner__text">{{ askBanner }}</text>
      </view>

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
          <text v-if="errors.end" class="field__error">{{ errors.end }}</text>
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

.ask-banner {
  /* .form 不是 flex column，没有 gap 可用：这条自己留出与下面那格的间距。 */
  margin-bottom: 24rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  border-left: 6rpx solid var(--mb-color-info);
}

.ask-banner__text {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--mb-color-text-primary);
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
