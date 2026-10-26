<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { blockGuestDeepLink } from '../../guest/deep-link'
import { askBannerCopy } from '../../assistant/ask-flow'
import { takeReminderDraft } from '../../assistant/draft-handoff'
import { NOTE_MAX_LENGTH, type MemberDto } from '@moonbud/shared'
import { EVENT_TYPES, isEventType, validateEventPayload, type EventType } from '@moonbud/shared'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { membersApi, remindersApi } from '../../api/endpoints'
import { EVENT_TYPE_META, fieldsFor, type FieldSpec } from '../../events/event-fields'
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
const askBanner = ref<string | null>(null)
const isRecurring = ref(false)
const presetKey = ref('daily')
const customKind = ref<RruleKind>('everyNDays')
const everyN = ref('2')
const weekday = ref(0)
const childId = ref('')
const assigneeId = ref('')
const actionType = ref('')
/**
 * 这一格碰过没有。编辑时存好的 payload 会整份回填，可界面只列必填项，
 * 提交又按界面上这几栏重建 —— 没碰过还照发就会把可选项（如药品"用法"）抹掉，
 * 所以没碰过就不发动作这两个键，让服务端把原来那份原样留着。
 */
const actionTouched = ref(false)
const actionValues = reactive<Record<string, string>>({})
/**
 * 编辑时读回来的那一份动作（类型 + payload）。界面上只列必填项，
 * 可选项没有栏可填，所以重建 payload 必须从这一份长出来，否则每编辑一次就抹掉一栏。
 */
const storedType = ref<EventType | null>(null)
const storedPayload = ref<Record<string, unknown>>({})
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
 * 「到点顺手记」的类型只由 pickAction 写入，所以 actionType 里只可能是空串或合法类型；
 * 这里把它过一次守卫，脏值（老数据、以后加的类型）就当没带动作。
 */
const actionEventType = computed(() => (isEventType(actionType.value) ? actionType.value : null))
/** 规范原话：这一格只列必填项，可选项到点了再补。 */
const actionFields = computed<FieldSpec[]>(() =>
  actionEventType.value ? fieldsFor(actionEventType.value).filter((f) => f.required) : [],
)
/** 必填的数字填了又不像数字：不能当成"没填"把它丢掉，得当场说出来。 */
const actionNumberField = computed(
  () =>
    actionFields.value.find((f) => {
      const raw = (actionValues[f.name] ?? '').trim()
      return f.kind === 'number' && raw !== '' && !Number.isFinite(Number(raw))
    }) ?? null,
)

/** 类型没换就沿用存好的那一份做底；换了类型，旧动作的可选项不该跟过来。 */
const keptExtras = computed<Record<string, unknown>>(() =>
  actionEventType.value === storedType.value ? storedPayload.value : {},
)

function buildActionPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...keptExtras.value }
  for (const field of actionFields.value) {
    const raw = (actionValues[field.name] ?? '').trim()
    if (!raw) continue
    if (field.kind === 'number') {
      const asNumber = Number(raw)
      if (Number.isFinite(asNumber)) payload[field.name] = asNumber
    } else {
      payload[field.name] = raw
    }
  }
  return payload
}

/** 必填项是不是每一栏都写了字（合不合格是另一回事）。 */
const actionFieldsFilled = computed(() =>
  actionFields.value.every((f) => (actionValues[f.name] ?? '').trim() !== ''),
)

/**
 * 提示语与提交分支的唯一依据：填齐必填项，并且这份预填过得了服务端那套完整校验。
 * 两边判读方式一致（服务端也只认完整 payload，半份直接 400），所以"齐"和"合法"在这里是同一件事。
 */
const actionReady = computed(
  () =>
    actionEventType.value !== null &&
    actionFieldsFilled.value &&
    validateEventPayload(actionEventType.value, buildActionPayload()).ok,
)

/**
 * 这一格现在真的会发生什么，就说什么。"还没填"和"填了又不合格"是两回事：
 * 后者字已经写进去了，再说"还没填全"会让人以为自己敲的东西丢了。
 * 睡眠/生长发育没有必填项，一栏都不填也算齐，那句得说清楚写下的是光板一条。
 */
const actionHint = computed(() => {
  if (actionReady.value) {
    return actionFields.value.length === 0
      ? '到点直接记：这一类没有必填项，点一下就记下光板一条，细节到点了再补'
      : '到点直接记：通知上点一下「记一笔」就写下这条'
  }
  // 生长发育：requiredFields 是空的，可 schema 的 refine 要至少一项测量值 ——
  // 对着一个空白格子说"必填项还没填全"或"都填了"都是疯话。
  if (actionFields.value.length === 0) return '这一格没有可填的栏，而这一类的预填还差一项：到点会打开记一笔'
  return actionFieldsFilled.value
    ? '必填项都填了，可这份预填不合格：到点只会打开记一笔'
    : '到点打开记一笔（必填项还没填全）'
})

/**
 * 编辑时没碰这一格，动作就整段不发：后端 PATCH 收不到的键原样留着，
 * 而界面只列必填项，重建不出存好的可选项。这一格的动作校验也一起让开，
 * 免得"改个标题"被人拦住。
 */
const actionKept = computed(() => isEdit.value && !actionTouched.value)

/**
 * 动作必须挂在某个孩子上：服务端对"带动作、没孩子"直接 400（提醒是家庭级的，
 * 而记录必须有归属）。所以这里不换状态，只把话说明白——和 pickType 同一套处理。
 */
function pickAction(next: EventType | ''): void {
  if (next && !childId.value) {
    uni.showToast({ title: '带动作的提醒要先选关联的孩子', icon: 'none' })
    return
  }
  actionTouched.value = true
  actionType.value = next
  for (const key of Object.keys(actionValues)) delete actionValues[key]
}

/** 选择型的那几栏走这里：既是写入也是"这一格我动过了"。 */
function setActionValue(name: string, value: string): void {
  actionTouched.value = true
  actionValues[name] = value
}

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
  if (!actionKept.value && actionType.value && !childId.value) errors.action = '带动作的提醒要先选关联的孩子'
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
    const action = {
      eventType: actionEventType.value,
      // 没填齐就不发：服务端只认完整 payload，半份会被 400 挡掉整条提醒。
      actionPayload: actionReady.value ? buildActionPayload() : null,
    }
    // 编辑时没碰这一格就当动作没参与：PATCH 收不到的键服务端原样留着，
    // 收得到就必须是完整的一份，而界面只能重建出必填项。
    const base = { title: title.value.trim(), ...schedule, ...shared, ...(actionKept.value ? {} : action) }
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
  // ---- 助手预填：「说一句话」换成的那份提醒草稿 ----
  // 不走 url：App 端 navigateTo 会把 query 的值再编码一遍，中文标题到手机上就是 %E5%AE%9D…
  // （见 assistant/draft-handoff.ts）。编辑那一路不取，免得把这份草稿白白烧掉。
  const asked = id ? null : takeReminderDraft()
  if (asked) {
    askBanner.value = askBannerCopy(asked.dropped)
    const askedTitle = asked.reminder.title
    // 截到 50：标题栏的 maxlength 就是 50，模型给 80 字时不截会在保存那一刻静默少字。
    if (askedTitle) title.value = askedTitle.slice(0, 50)
    const [askedDate = '', askedTime = ''] = (asked.reminder.dueAtWallClock ?? '').split('T')
    if (/^\d{4}-\d{2}-\d{2}$/.test(askedDate)) date.value = askedDate
    if (/^\d{2}:\d{2}$/.test(askedTime)) time.value = askedTime
    const askedRrule = asked.reminder.rrule ?? ''
    if (askedRrule) {
      // 周期用编辑那一路同一把尺子量回来（parseRruleForUi），不自拆字符串：两套拆法必然漂移。
      const parsed = parseRruleForUi(askedRrule)
      // 量不出来就只留上面那个钟点，周期档位停在原样——把人写成"每天"是谎报。
      if (parsed) {
        isRecurring.value = true
        presetKey.value = parsed.key
        customKind.value = parsed.kind
        everyN.value = String(parsed.n ?? 2)
        weekday.value = parsed.weekday ?? 0
        // 「每天早 8 点」这类草稿只有 rrule、没有 dueAtWallClock：
        // 钟点就得从规则里读回来。不读的话这一格停在打开页面的那一刻，保存又按它重拼规则，
        // 提醒从此永远在那个钟点响。补零两位和编辑那一路同一个口径。
        time.value = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
      }
    }
    const askedChildId = asked.childId ?? ''
    // 只认这一家的孩子：一个陌生 id 会让表单显示"已选中"，而提醒挂在一个不相干的孩子身上。
    if (askedChildId && children.value.some((c) => c.id === askedChildId)) childId.value = askedChildId
    const askedEventType = asked.reminder.eventType ?? ''
    if (isEventType(askedEventType)) {
      actionType.value = askedEventType
      // 只填动作类型和负载，不碰 storedType/storedPayload：那是"上次存好的那一份"，新建时不该有。
      const rawAction = asked.reminder.actionPayload
      if (rawAction && Object.keys(rawAction).length > 0) {
        // 只回填界面上有的栏；数字也按字符串存，和手输那一栏、buildActionPayload 同一口径。
        for (const field of actionFields.value) {
          const value = rawAction[field.name]
          if (typeof value === 'string' || typeof value === 'number') {
            actionValues[field.name] = String(value)
          }
        }
      }
    }
  }
  if (!id) return
  reminderId.value = id
  try {
    const reminder = await remindersApi.get(familyId.value, id)
    title.value = reminder.title
    note.value = reminder.note ?? ''
    childId.value = reminder.childId ?? ''
    assigneeId.value = reminder.assigneeId ?? ''
    actionType.value = reminder.eventType ?? ''
    storedType.value = isEventType(reminder.eventType ?? '') ? reminder.eventType : null
    storedPayload.value = { ...(reminder.actionPayload as Record<string, unknown> | null ?? {}) }
    for (const key of Object.keys(actionValues)) delete actionValues[key]
    // 预填原样回填成字符串：数字字段也用字符串存，输入框与 buildActionPayload 同一套口径。
    for (const [key, value] of Object.entries(reminder.actionPayload ?? {})) {
      actionValues[key] = String(value)
    }
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

      <!-- 这句话是助手唯一一次当着人的面开口：它得说清这份草稿是从"你刚说的那一句"来的，
           并且把没填上的栏一起说了——格子还空着时不许报喜。 -->
      <view v-if="askBanner" class="ask-banner">
        <text class="ask-banner__text">{{ askBanner }}</text>
      </view>

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
        <text class="field__label">到点顺手记</text>
        <view class="field__row">
          <view class="chip" :class="{ 'chip--active': actionType === '' }" @click="pickAction('')">
            <text class="chip__label">不带动作</text>
          </view>
          <view v-for="t in EVENT_TYPES" :key="t" class="chip" :class="{ 'chip--active': actionType === t }" @click="pickAction(t)">
            <text class="chip__label">{{ EVENT_TYPE_META[t].icon }} {{ EVENT_TYPE_META[t].label }}</text>
          </view>
        </view>

        <template v-if="actionType">
          <view v-for="field in actionFields" :key="field.name" class="subfield">
            <text class="field__label">{{ field.label }} *</text>
            <view v-if="field.kind === 'select'" class="field__row">
              <view
                v-for="option in field.options"
                :key="option.value"
                class="chip"
                :class="{ 'chip--active': actionValues[field.name] === option.value }"
                @click="setActionValue(field.name, option.value)"
              >
                <text class="chip__label">{{ option.label }}</text>
              </view>
            </view>
            <input
              v-else
              v-model="actionValues[field.name]"
              class="field__input"
              :type="field.kind === 'number' ? 'digit' : 'text'"
              :placeholder="field.placeholder"
              @input="actionTouched = true"
            />
          </view>
          <text v-if="actionNumberField" class="field__error">{{ actionNumberField.label }}请填写数字</text>
          <text class="field__hint">
            {{ actionHint }}
          </text>
        </template>
        <text v-else class="field__hint">不带动作就只是提醒，到点了不会替你记任何东西。</text>
        <text v-if="errors.action" class="field__error">{{ errors.action }}</text>
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

.ask-banner {
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

/* 「到点顺手记」的预填项：同一张卡片里的小节，间距比顶层字段紧一档。 */
.subfield {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
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
