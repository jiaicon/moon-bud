<script setup lang="ts">
import { EVENT_TYPES, type EventDto, type EventType, type MemberDto } from '@moonbud/shared'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { computed, getCurrentInstance, nextTick, ref, watch, type Ref } from 'vue'
import { eventsApi, membersApi } from '../../api/endpoints'
import { canModifyEvent, stageForEdit } from '../../events/event-edit'
import { centerScrollLeft } from '../../events/chip-scroll'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { groupByDay } from '../../events/day-groups'
import { buildEventQuery, emptyListCopy, rangeBounds, RANGE_OPTIONS, recorderOptions, type EventRange } from '../../events/list-filters'
import { csvFileName, exportCsv, saveCsv } from '../../events/csv-export'
import { applyPendingUpdates, filterRows, pendingCreateRows, pendingDeletedIds } from '../../sync/pending-view'
import { refreshUnreadTabBadge } from '../../notifications/tab-badge'
import { formatEventLine } from '../../events/format-event'
import { confirmDanger } from '../../utils/confirm'
import { guardForcedChange } from '../../utils/forced-change'
import EmptyState from '../../components/EmptyState.vue'
import GuestGuide from '../../components/GuestGuide.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'
import { useOutboxStore } from '../../stores/outbox'

const PAGE_SIZE = 20

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const childStore = useChildStore()
const outboxStore = useOutboxStore()

const isGuest = computed(() => authStore.isGuest)

const events = ref<EventDto[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const typeFilter = ref<EventType | ''>('')
const typeSheetOpen = ref(false)
const recorderFilter = ref<string>('')
const rangeFilter = ref<EventRange>('')
/** 这一家的成员。空数组既可能是"只有我一个人"，也可能是"还没读到"，页面不替用户猜。 */
const members = ref<MemberDto[]>([])
const recorders = computed(() => recorderOptions(members.value, authStore.user?.id ?? ''))

/** 抽屉里要列全：横滑的 tabs 看不见不代表没有这一类。 */
const typeOptions = computed<{ value: EventType | ''; label: string }[]>(() => [
  { value: '', label: '全部' },
  ...EVENT_TYPES.map((t) => ({ value: t, label: `${EVENT_TYPE_META[t].icon} ${EVENT_TYPE_META[t].label}` })),
])

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const childId = computed(() => childStore.currentChild(familyId.value)?.id ?? '')
// 这个家庭的名单是不是已经读到过。没读到过 != 没有孩子。
const childrenLoaded = computed(() => familyId.value in childStore.childrenByFamily)
// 只在这次请求真的失败了才算失败：error 是全局的，别把上一次或别的家庭的错误算进来。
const childrenLoadFailed = computed(
  () => !childrenLoaded.value && !childStore.loading && childStore.error !== null,
)
const hasMore = computed(() => events.value.length < total.value)

/**
 * 筛出来是空的 ≠ 家里没有记录。把筛项念出来，用户才知道自己筛的是"爷爷 + 喂奶"
 * 而不是"这个家什么都没记过"——后者会让人以为记录丢了。
 */
const emptyCopy = computed(() =>
  emptyListCopy([
    typeFilter.value ? EVENT_TYPE_META[typeFilter.value].label : '',
    childId.value ? children.value.find((c) => c.id === childId.value)?.name ?? '这个孩子' : '',
    recorderFilter.value
      ? recorders.value.find((o) => o.value === recorderFilter.value)?.label ?? '这个人'
      : '',
    rangeFilter.value ? RANGE_OPTIONS.find((o) => o.value === rangeFilter.value)?.label ?? '' : '',
  ].filter(Boolean)),
)

/** 按天分组：家长回忆"那天下午"，不是"14:32 那条"。 */
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')

const sessionMeta = computed(() => ({
  userId: authStore.user?.id ?? '',
  nickname: authStore.user?.nickname ?? '',
}))

/** 本机已判定要删、只是没传上去的记录 id：这些要先从列表里藏起来，否则删了还在眼前。 */
const pendingDeleted = computed(() => pendingDeletedIds(outboxStore.items, familyId.value))

/** 待同步的创建投影成行，并套上和列表一致的筛项——待同步是状态，不是免检通行证。 */
const pendingRows = computed(() =>
  filterRows(pendingCreateRows(outboxStore.items, familyId.value, sessionMeta.value), {
    type: typeFilter.value,
    childId: childId.value,
    createdBy: recorderFilter.value,
    ...rangeBounds(rangeFilter.value, timezone.value),
  }),
)
const pendingIds = computed(() => new Set(pendingRows.value.map((r) => r.id)))

/** 服务端已有但被判为待删的先滤掉，编辑盖在行上，再并进来的创建，按发生时间倒序。 */
const timelineEvents = computed(() => {
  // 离线改一条记录，表单已经说"已存到待同步"，列表却还念服务器上的旧数字——
  // 那一趟 PATCH 得盖上去，两页（列表与统计）才在算同一份数据。
  const server = applyPendingUpdates(
    events.value.filter((e) => !pendingDeleted.value.has(e.id)),
    outboxStore.items,
    familyId.value,
  )
  return [...pendingRows.value, ...server].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  )
})
const groups = computed(() => groupByDay(timelineEvents.value, timezone.value))

async function run(reset: boolean): Promise<void> {
  if (!familyId.value) return
  loading.value = true
  error.value = null
  const next = reset ? 1 : page.value + 1
  try {
    const bounds = rangeBounds(rangeFilter.value, timezone.value)
    const res = await eventsApi.list(
      familyId.value,
      buildEventQuery({ type: typeFilter.value, childId: childId.value, createdBy: recorderFilter.value, ...bounds }, next, PAGE_SIZE),
    )
    events.value = reset ? res.items : [...events.value, ...res.items]
    total.value = res.total
    page.value = next
  } catch (err) {
    error.value = err instanceof Error ? err.message : '记录加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 刷新来源有四条（进入、回到本页、下拉、换家庭），并发时后一次必须真的跑，
 * 而不是被"正在加载"挡掉 —— 挡掉的结果就是列表停在旧家庭/旧页码上。
 * 所以排一条链，loading 只用来给 UI 和上拉加载判断"现在忙不忙"。
 */
let queue: Promise<void> = Promise.resolve()

function load(reset: boolean): Promise<void> {
  const next = queue.then(() => run(reset))
  queue = next.catch(() => undefined)
  return next
}

/**
 * "按记录人筛"那一行的名单，问服务端要：记录里出现过哪些人 ≠ 这家有哪几个人
 * （某人这一个月没记过任何东西，他不该从筛项里消失）。
 *
 * 读失败就留空，那一行不画：没有筛项可用顶多是少个便利，画一排猜出来的名字是骗人。
 */
async function loadMembers(): Promise<void> {
  if (!familyId.value) return
  try {
    members.value = await membersApi.list(familyId.value)
  } catch {
    members.value = []
  }
}

// onLoad 里已经拉过一次；onShow 只负责"从别处回到本页"的那些场合。
// 用 ready 而不是"列表非空"来判定：第一条记录保存回来时列表正是空的。
let ready = false

/** 进入这一屏：会话没落定之前什么都不读，游客这一屏一条请求都不发。 */
async function enter(): Promise<void> {
  // isLoggedIn 是内存态，冷启动第一帧必然是 null；不等它就判游客，
  // 老用户打开应用会先看一眼"来登录吧"。
  if (authStore.session === 'unknown') await authStore.bootstrap()
  // 游客，以及"问过但问不出来"的那一趟：一条请求都不发。发出去的 401 会被
  // 当成会话过期再弹一遍提示，而这一屏本来就没东西要保护。
  if (!authStore.isLoggedIn) return
  outboxStore.load()
  await familyStore.load()
  if (familyId.value) {
    await Promise.all([childStore.load(familyId.value), loadMembers()])
  }
  await load(true)
  ready = true
}

onLoad(() => void enter())

// 从表单返回时必须看到新记录，比"表单在返回前刷新列表"更可靠：
// 任何回到本页的路径都会触发，不只是保存成功那一条。
onShow(() => {
  // 拿着临时密码的人不该能在记录页里往下翻（四页各拦，判据是改密页在不在栈顶）。
  guardForcedChange(authStore.mustChangePassword)
  // 游客这一屏不画角标：那是上一个账号留下的未读数，留着不放等于替他保管。
  if (!authStore.isLoggedIn) return
  // 从没跑成过首屏那次取数（例如刚在本页登录完）就补一次 enter：这一份实例不会被
  // 重建，不补就停在"还没有家庭"上，而这个人其实早就有。
  if (ready) void load(true)
  else void enter()
  // tabBar 这时才挂载好，冷启动的 App.onShow 里画角标会落空，得在落地页补。
  void refreshUnreadTabBadge()
})

// 换家庭时孩子缓存属于上一个家庭：不重拉就把"有孩子的家庭"说成没有孩子，
// 而且 childId 为空时列表请求不带过滤条件，全家记录混在一起。
watch(familyId, async (next, prev) => {
  if (!next || next === prev || !ready) return
  // 上一个家庭的成员与"筛着某个人"在这里都没有意义：名单重拉，筛项清空。
  recorderFilter.value = ''
  await Promise.all([childStore.load(next), loadMembers()])
  await load(true)
})

// 转圈由发起刷新的这一侧来停：run 里的提前 return（还没有家庭）不会走到 finally。
onPullDownRefresh(() => {
  void Promise.all([load(true), loadMembers()]).finally(() => uni.stopPullDownRefresh())
})
onReachBottom(() => {
  if (hasMore.value && !loading.value) void load(false)
})

/**
 * 筛选对游客也点得动：顶行两排 chips 与那颗展开按钮改的都是本地筛项，
 * 取数由 run() 开头"没有家庭就返回"挡着。游客要登录只有引导那一颗，不弹窗拦他。
 */
function pickType(next: EventType | '') {
  if (typeFilter.value === next) return
  typeFilter.value = next
  void load(true)
}

function pickChild(next: string) {
  if (!familyId.value) return
  childStore.select(familyId.value, next)
  void load(true)
}

function pickRecorder(next: string) {
  if (recorderFilter.value === next) return
  recorderFilter.value = next
  void load(true)
}

function pickRange(next: EventRange) {
  if (rangeFilter.value === next) return
  rangeFilter.value = next
  void load(true)
}

/** 展开抽屉列的是类型的全体，横滑看不见的那些在这里给出来。 */
function openTypeSheet() {
  typeSheetOpen.value = true
}

const exporting = ref(false)

/** 当前筛项对应的查询条件（不含分页）——列表和导出必须用同一份，否则"导出当前"就名不副实。 */
function currentFilters(): Parameters<typeof buildEventQuery>[0] {
  return {
    type: typeFilter.value,
    childId: childId.value,
    createdBy: recorderFilter.value,
    ...rangeBounds(rangeFilter.value, timezone.value),
  }
}

/**
 * 导出的是"当前筛出来的这一份"，不是屏幕上滚到的那几页。所以按后端单页上限 100
 * 一路翻到底，把 total 条取齐——用户筛"近 7 天 + 爷爷记的"再导出，拿到的就正好是那些。
 */
async function fetchAllMatching(): Promise<EventDto[]> {
  const base = currentFilters()
  const collected: EventDto[] = []
  let page = 1
  let total = Infinity
  while (collected.length < total) {
    const res = await eventsApi.list(familyId.value, buildEventQuery(base, page, 100))
    collected.push(...res.items)
    total = res.total
    if (res.items.length === 0) break // 万一 total 与实页数对不上，也别死循环
    page += 1
  }
  return collected
}

/**
 * 导出的必须就是屏幕上那一份：本机还没传上去的新增要在表里、删掉的不能还在、
 * 改过的要念改后的值。屏幕用 timelineEvents（已加载的那几页），导出把同一组
 * 投影套在"翻到底"的完整结果上——两边只差在页数，不差在身份。
 */
function exportRows(serverEvents: EventDto[]): EventDto[] {
  const kept = applyPendingUpdates(
    serverEvents.filter((e) => !pendingDeleted.value.has(e.id)),
    outboxStore.items,
    familyId.value,
  )
  return [...pendingRows.value, ...kept].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  )
}

async function exportCurrent(): Promise<void> {
  // 游客那一颗按钮根本不画（模板上的 v-if），这一格挡的是深链与以后别处的复用。
  if (!familyId.value || exporting.value) return
  exporting.value = true
  uni.showLoading({ title: '正在导出…' })
  try {
    const rows = exportRows(await fetchAllMatching())
    const name = csvFileName(
      rangeFilter.value ? RANGE_OPTIONS.find((o) => o.value === rangeFilter.value)?.label ?? '' : '',
      new Date(),
      timezone.value,
    )
    saveCsv(name, exportCsv(rows, children.value, timezone.value))
    uni.showToast({ title: `已导出 ${rows.length} 条`, icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '导出失败', icon: 'none' })
  } finally {
    uni.hideLoading()
    exporting.value = false
  }
}

/**
 * 选中的芯片滚到容器中间：横滑条上"当前筛的是哪一类"不该藏在屏幕外，
 * 从右侧抽屉里选完尤其如此 —— 抽屉列的是全集，滑不到那一项。
 * 芯片的 scroll-view 不挂 scroll-with-animation：H5 带动画的 scroll-left 走
 * transform 覆盖层，一旦和真实 scrollLeft 对不上，后续值会被 uni 判为"无需动"而丢掉。
 */
const instance = getCurrentInstance()
const typeScrollLeft = ref(0)
const childScrollLeft = ref(0)
const recorderScrollLeft = ref(0)
const typeIndex = computed(() => typeOptions.value.findIndex((o) => o.value === typeFilter.value))
const childIndex = computed(() => children.value.findIndex((c) => c.id === childId.value))
const recorderIndex = computed(() => recorders.value.findIndex((o) => o.value === recorderFilter.value))

function centerChip(containerId: string, rowId: string, chipId: string, index: number, target: Ref<number>): void {
  if (!instance || index < 0) return
  const query = uni.createSelectorQuery().in(instance)
  query.select(`#${containerId}`).boundingClientRect()
  query.select(`#${rowId}`).boundingClientRect()
  query.select(`#${chipId}`).boundingClientRect()
  query.exec((res) => {
    const [box, row, chip] = (res ?? []) as Array<Record<string, number> | null>
    if (!box || !row || !chip) return
    applyScroll(target, centerScrollLeft({
      containerWidth: box.width ?? 0,
      rowLeft: row.left ?? 0,
      rowWidth: row.width ?? 0,
      chipLeft: chip.left ?? 0,
      chipWidth: chip.width ?? 0,
    }))
  })
}

/**
 * uni 的 scroll-left 是"变了才滚"，用户手动滑过之后光靠赋值滚不回来，
 * 所以同值时借 1px 走一圈：先顶出去，下一帧再落回真正想要的位置。
 */
function applyScroll(target: Ref<number>, value: number): void {
  if (target.value !== value) {
    target.value = value
    return
  }
  target.value = value + 1
  void nextTick(() => {
    target.value = value
  })
}

watch([typeIndex, childIndex, recorderIndex], ([t, c, r]) => {
  centerChip('type-chips', 'type-chip-row', `chip-type-${t}`, t, typeScrollLeft)
  centerChip('child-chips', 'child-chip-row', `chip-child-${c}`, c, childScrollLeft)
  centerChip('recorder-chips', 'recorder-chip-row', `chip-recorder-${r}`, r, recorderScrollLeft)
}, { flush: 'post' })

/** 抽屉里点一次就完事：选完立刻收起，不然用户还得再点一次遮罩。 */
function chooseType(next: EventType | '') {
  typeSheetOpen.value = false
  pickType(next)
}

const goForm = () => uni.navigateTo({ url: '/pages/event-form/index' })
const goFamily = () => uni.navigateTo({ url: '/pages/family-select/index' })
const goChild = () => uni.navigateTo({ url: '/pages/child-form/index' })

// 名单读失败时"正在读取"会一直挂着，得给一条出路。
async function retryChildren(): Promise<void> {
  if (!familyId.value) return
  if (await childStore.load(familyId.value)) await load(true)
}

/** 点"待同步 N"手动催一趟：上传成功后重新拉列表，把那条从待同步换成服务端确认过的那份。 */
async function retrySync(): Promise<void> {
  if (outboxStore.flushing) return
  await outboxStore.flush()
  await load(true)
}

const myRole = computed(() => familyStore.currentFamily?.role ?? null)

function editEvent(event: EventDto): void {
  // 待同步的创建还没进服务端，后端也没有 GET /events/:id，编辑无从下手；
  // 让它先同步上去，界面不假装能改一条还不存在的记录。
  if (pendingIds.value.has(event.id)) {
    uni.showToast({ title: '这条还在待同步，上传后才能编辑', icon: 'none' })
    return
  }
  if (!canModifyEvent(event, authStore.user?.id ?? null, myRole.value)) {
    uni.showToast({ title: '只有记这条的人或管理员能改', icon: 'none' })
    return
  }
  // 后端没有 GET /events/:id，整条记录由这里交接给表单（见 events/event-edit.ts）。
  stageForEdit(event)
  uni.navigateTo({ url: `/pages/event-form/index?id=${event.id}` })
}

async function removeEvent(event: EventDto): Promise<void> {
  // 撤掉一条还没上传的创建：直接把它从待同步里拿掉，就当没记过。
  if (pendingIds.value.has(event.id)) {
    const entry = outboxStore.items.find((i) => i.op === 'create' && i.eventId === event.id)
    if (entry) outboxStore.removeEntry(entry.entryId)
    uni.showToast({ title: '已从待同步里撤掉', icon: 'none' })
    return
  }
  if (!canModifyEvent(event, authStore.user?.id ?? null, myRole.value)) {
    uni.showToast({ title: '只有记这条的人或管理员能删', icon: 'none' })
    return
  }
  const go = await confirmDanger({
    title: '删掉这条记录？',
    content: `${formatEventLine(event, timezone.value)} —— ${event.createdByNickname} 记的。删掉后全家都看不到它了。`,
    confirmText: '删除',
  })
  if (!go) return
  try {
    const res = await outboxStore.submitDelete(familyId.value, event.id)
    // 无论在线删除成功还是排进待同步，这一条都该立刻从眼前消失：
    // 成功时本地把服务端那份拿掉，排队时靠 pendingDeleted 把它藏起来——两种都不该还说"已删除"。
    events.value = events.value.filter((e) => e.id !== event.id)
    if (res.kind === 'saved') total.value = Math.max(0, total.value - 1)
    uni.showToast({ title: res.kind === 'queued' ? '已排到待同步，恢复网络后自动删除' : '已删除', icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' })
  }
}
</script>

<template>
  <theme-root>
    <view class="timeline">
      <!-- 会话还没问出来的那一瞬，无论是"来登录吧"还是"去创建家庭"，两句都是谎话。 -->
      <empty-state
        v-if="authStore.session === 'unknown'"
        icon="🌙"
        title="正在确认登录状态"
        hint="稍一下下，这一家的记录马上就来。"
      />

      <!--
        游客这一屏画同一副筛选栏（它就是这一页的主要功能），列表区换成引导。
        所以那三句家庭话只对会员说：游客没有家庭是意料之中，不是要他去建一个。
      -->
      <empty-state
        v-else-if="!isGuest && !familyId"
        icon="🏠"
        title="还没有家庭"
        hint="创建一个家庭，全家才能共用同一份记录。"
        action-label="去创建家庭"
        @action="goFamily"
      />

      <empty-state
        v-else-if="!isGuest && !childrenLoaded"
        icon="👶"
        :title="childrenLoadFailed ? '孩子名单没加载出来' : '正在读取孩子名单'"
        :hint="childrenLoadFailed ? (childStore.error ?? '网络或后端暂时不可用，重试一下即可。') : '记录要按孩子来看，稍一下下。'"
        :action-label="childrenLoadFailed ? '重试' : undefined"
        @action="retryChildren"
      />

      <empty-state
        v-else-if="!isGuest && !childId"
        icon="👶"
        title="这个家庭还没有孩子"
        hint="记录要有归属的孩子才记得下。"
        action-label="添加孩子"
        @action="goChild"
      />

      <template v-else>
        <!-- 会员与游客共用这一份筛选栏：复制两遍就会有一份跟着不上改动。 -->
        <view class="timeline__filters">
          <view class="filter-bar">
            <scroll-view
              id="type-chips"
              scroll-x
              class="chips"
              :show-scrollbar="false"
              :scroll-left="typeScrollLeft"
            >
              <view id="type-chip-row" class="chip-row">
                <view
                  v-for="(opt, oi) in typeOptions"
                  :id="`chip-type-${oi}`"
                  :key="opt.value"
                  class="chip"
                  :class="{ 'chip--active': typeFilter === opt.value }"
                  @click="pickType(opt.value)"
                >
                  <text class="chip__label">{{ opt.label }}</text>
                </view>
              </view>
            </scroll-view>

            <!-- 横滑看不见的类型在这里全给出来，按钮本身不跟着滚。 -->
            <view class="expand" @click="openTypeSheet">
              <text class="expand__glyph">☰</text>
            </view>
          </view>

          <!-- 时间范围：4 项一行放得下，不需要横滑。默认"全部"，选了才带 from/to。 -->
          <view class="range-row">
            <view
              v-for="opt in RANGE_OPTIONS"
              :key="opt.value"
              class="chip"
              :class="{ 'chip--active': rangeFilter === opt.value }"
              @click="pickRange(opt.value)"
            >
              <text class="chip__label">{{ opt.label }}</text>
            </view>
            <!-- 导出贴在这一行末尾：它作用于"当前这套筛项"，放得越靠近筛项越不像另一回事。
                 游客不画：导出要读的是全家的记录，而他连家庭都没有。 -->
            <view v-if="!isGuest" class="export" :class="{ 'export--busy': exporting }" @click="exportCurrent">
              <text class="export__label">{{ exporting ? '导出中…' : '导出 CSV' }}</text>
            </view>
          </view>

          <scroll-view
            v-if="children.length > 1"
            id="child-chips"
            scroll-x
            class="chips"
            :show-scrollbar="false"
            :scroll-left="childScrollLeft"
          >
            <view id="child-chip-row" class="chip-row">
              <view
                v-for="(c, ci) in children"
                :id="`chip-child-${ci}`"
                :key="c.id"
                class="chip"
                :class="{ 'chip--active': c.id === childId }"
                @click="pickChild(c.id)"
              >
                <text class="chip__label">{{ c.name }}</text>
              </view>
            </view>
          </scroll-view>

          <!-- 一家只有一个人时"谁记的"没有可筛的，这一行就不出现。 -->
          <scroll-view
            v-if="recorders.length > 1"
            id="recorder-chips"
            scroll-x
            class="chips"
            :show-scrollbar="false"
            :scroll-left="recorderScrollLeft"
          >
            <view id="recorder-chip-row" class="chip-row">
              <view
                v-for="(r, ri) in recorders"
                :id="`chip-recorder-${ri}`"
                :key="r.value"
                class="chip"
                :class="{ 'chip--active': r.value === recorderFilter }"
                @click="pickRecorder(r.value)"
              >
                <text class="chip__label">{{ r.label }}</text>
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 待同步横幅：有几条压在本机等上传，就把它摆在列表最上面，并给一条手动催的出口。
             游客不画：那一队是上一个账号留在这台手机上的。 -->
        <view
          v-if="!isGuest && outboxStore.pendingCount"
          class="pending"
          :class="{ 'pending--busy': outboxStore.flushing }"
          @click="retrySync"
        >
          <text class="pending__text">
            {{ outboxStore.flushing ? '正在同步…' : `待同步 ${outboxStore.pendingCount} 条 · 点此重试` }}
          </text>
        </view>

        <text v-if="error" class="timeline__error">{{ error }}</text>

        <view v-for="group in groups" :key="group.key" class="group">
          <text class="group__label">{{ group.label }}</text>
          <view v-for="event in group.items" :key="event.id" class="card" :class="{ 'card--pending': pendingIds.has(event.id) }">
            <view class="card__main" @click="editEvent(event)">
              <text class="card__line">{{ formatEventLine(event, timezone) }}</text>
              <text v-if="pendingIds.has(event.id)" class="card__who">还在本机 · 恢复网络后自动上传</text>
              <text v-else class="card__who">{{ event.createdByNickname }} 记 · 点此编辑</text>
            </view>
            <view class="card__delete" @click="removeEvent(event)">
              <text class="card__delete-label">{{ pendingIds.has(event.id) ? '撤掉' : '删除' }}</text>
            </view>
          </view>
        </view>

        <view v-if="groups.length" class="bottom-spacer" />

        <!-- 空白区：游客看到的是"来登录吧"，会员看到的是"这个筛法没东西"。 -->
        <guest-guide v-if="isGuest" page="events" />

        <empty-state
          v-else-if="!loading && !groups.length && !error"
          icon="🌱"
          :title="emptyCopy.title"
          :hint="emptyCopy.hint"
        />
        <text v-if="loading" class="timeline__loading">加载中…</text>
      </template>

      <view v-if="childId && !isGuest" class="fab" @click="goForm"><text class="fab__label">＋</text></view>

      <u-popup
        v-model="typeSheetOpen"
        mode="right"
        length="520rpx"
        :safe-area-inset-bottom="true"
        @close="typeSheetOpen = false"
      >
        <view class="sheet">
          <text class="sheet__title">按类型筛选</text>
          <view
            v-for="opt in typeOptions"
            :key="opt.value"
            class="sheet__item"
            :class="{ 'sheet__item--active': typeFilter === opt.value }"
            @click="chooseType(opt.value)"
          >
            <text class="sheet__item-label">{{ opt.label }}</text>
          </view>
        </view>
      </u-popup>
    </view>
  </theme-root>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  /* 可视区高度：状态栏/导航栏与 tabBar 各占掉的量由 uni-app 变量给出。 */
  min-height: calc(100vh - var(--window-top) - var(--window-bottom));
  padding: 24rpx 32rpx 40rpx;
  box-sizing: border-box;
}

/* 列表末尾留白：高度让最后一张卡片能滚到 FAB 之上。空状态不给这段，
   否则 min-height 会被内容顶开，"居中"就变成偏下。 */
.bottom-spacer {
  height: 140rpx;
}

.timeline__filters {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.filter-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.range-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
}

.export {
  margin-left: auto;
  flex-shrink: 0;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
}

.export--busy {
  opacity: 0.6;
}

.export__label {
  white-space: nowrap;
  font-size: 24rpx;
  color: var(--mb-color-text-primary);
}

.chips {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.chip-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  /* 让行自己的盒子等于芯片总宽：不撑开的话它只有容器宽，
     居中要用的"内容有多长"量不到，芯片全靠溢出显示。 */
  width: fit-content;
  min-width: 100%;
}

.chip {
  flex-shrink: 0;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.chip--active {
  background-color: var(--mb-color-primary);
}

.chip__label {
  white-space: nowrap;
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.chip--active .chip__label {
  color: var(--mb-color-on-primary);
}

.expand {
  flex-shrink: 0;
  width: 72rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
}

.expand__glyph {
  font-size: 30rpx;
  line-height: 1;
  color: var(--mb-color-text-primary);
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 60rpx 24rpx 40rpx;
}

.sheet__title {
  margin-bottom: 16rpx;
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.sheet__item {
  padding: 22rpx 20rpx;
  border-radius: 16rpx;
}

.sheet__item--active {
  background-color: var(--mb-color-surface-alt);
}

.sheet__item-label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.sheet__item--active .sheet__item-label {
  color: var(--mb-color-primary);
}

.timeline__error {
  display: block;
  margin: 20rpx 0;
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.pending {
  padding: 16rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  border-left: 6rpx solid var(--mb-color-warning);
}

.pending--busy {
  opacity: 0.6;
}

.pending__text {
  font-size: 24rpx;
  color: var(--mb-color-text-primary);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 32rpx;
}

.group__label {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--mb-color-text-secondary);
}

.card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

/* 待同步的行要看得出来"还没进云端"：虚线边框 + 略淡，一眼区分于已上传的实心卡片。 */
.card--pending {
  border: 2rpx dashed var(--mb-color-border);
  background-color: var(--mb-color-surface-alt);
}

.card__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.card__delete {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--mb-color-border);
}

.card__delete-label {
  font-size: 22rpx;
  color: var(--mb-color-error);
}

.card__line {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.card__who {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.timeline__loading {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
  text-align: center;
}

.fab {
  position: fixed;
  right: 40rpx;
  /* 不加 --window-bottom 的话，按钮的下半截正好被 tabBar 盖住。 */
  bottom: calc(var(--window-bottom) + 40rpx);
  width: 108rpx;
  height: 108rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.18);
}

.fab__label {
  font-size: 48rpx;
  color: var(--mb-color-on-primary);
}
</style>
