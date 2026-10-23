import type { ChildDto, EventDto, FamilyDto, ReminderDto } from '@moonbud/shared'

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()
const hoursFromNow = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString()

const FAMILY_ID = 'preview-family'
const CHILD_ID = 'preview-child'
const OWNER_ID = 'preview-owner'
const DAD_ID = 'preview-dad'
const NOW = () => new Date().toISOString()

export const MOCK_FAMILY: FamilyDto = {
  id: FAMILY_ID,
  name: '小满一家',
  ownerId: OWNER_ID,
  role: 'OWNER',
  archivedAt: null,
}

export const MOCK_CHILD: ChildDto = {
  id: CHILD_ID,
  familyId: FAMILY_ID,
  name: '小满',
  gender: 'FEMALE',
  birthday: '2025-06-01',
  avatarUrl: null,
  archivedAt: null,
}

const event = (
  id: string,
  type: EventDto['type'],
  minutesAgoValue: number,
  payload: EventDto['payload'],
  note: string | null,
  by: string,
  nickname: string,
): EventDto => ({
  id,
  familyId: FAMILY_ID,
  childId: CHILD_ID,
  type,
  occurredAt: minutesAgo(minutesAgoValue),
  endedAt: type === 'sleep' ? minutesAgo(Math.max(minutesAgoValue - 95, 1)) : null,
  payload,
  note,
  createdBy: by,
  createdByNickname: nickname,
  updatedBy: null,
  // 预览演示的是"记下来的样子"，不演示出处——出处只在到点那一按上起作用。
  fromReminderId: null,
  createdAt: minutesAgo(minutesAgoValue),
  updatedAt: NOW(),
})

/**
 * 时间一律相对当下生成，预览里的"20 分钟前"才是真的 20 分钟前——
 * 写死时间戳会让首页概览在半年后显示"8 个月前"，预览就废了。
 */
export const MOCK_EVENTS: EventDto[] = [
  event('e-feeding', 'feeding', 20, { method: 'bottle', amountMl: 120 }, '喝完了一整瓶', DAD_ID, '爸爸'),
  event('e-sleep', 'sleep', 150, { quality: 'good' }, null, OWNER_ID, '妈妈'),
  event('e-diaper', 'diaper', 65, { kind: 'pee' }, null, OWNER_ID, '妈妈'),
  event('e-diaper-2', 'diaper', 240, { kind: 'poo', color: 'golden' }, null, DAD_ID, '爸爸'),
  event('e-temperature', 'temperature', 300, { celsius: 36.8, site: 'axillary' }, '有点温热，实测正常', OWNER_ID, '妈妈'),
  event('e-milestone', 'milestone', 1_440, { title: '第一次翻身' }, '全家都看见了', DAD_ID, '爸爸'),
]

export const MOCK_REMINDERS: ReminderDto[] = [
  {
    id: 'r-overdue',
    familyId: FAMILY_ID,
    childId: CHILD_ID,
    title: '补喂维生素 D',
    note: '饭后半小时',
    type: 'ONE_TIME',
    dueAt: minutesAgo(45),
    rrule: null,
    timezone: 'Asia/Shanghai',
    assigneeId: DAD_ID,
    // 预览不演示"到点顺手记"，两条 mock 提醒都没有动作。
    eventType: null,
    actionPayload: null,
    status: 'ACTIVE',
    createdBy: OWNER_ID,
    createdAt: minutesAgo(300),
    // 预览要能演示出"还欠哪一次"这行文案，不然游客看到的永远是还没到点的样子。
    overdueSince: minutesAgo(45),
  },
  {
    id: 'r-future',
    familyId: FAMILY_ID,
    childId: null,
    title: '儿保体检',
    note: '社区医院 3 楼',
    type: 'ONE_TIME',
    dueAt: hoursFromNow(6),
    rrule: null,
    timezone: 'Asia/Shanghai',
    assigneeId: null,
    eventType: null,
    actionPayload: null,
    status: 'ACTIVE',
    createdBy: OWNER_ID,
    createdAt: minutesAgo(1_440),
    overdueSince: null,
  },
]

export const PREVIEW_SCREENS: {
  key: 'home' | 'timeline' | 'reminders' | 'family'
  title: string
  caption: string
}[] = [
  {
    key: 'home',
    title: '首页',
    caption: '一眼看到上次喂奶、上次睡眠和今天换了几次尿布，不必翻记录。',
  },
  {
    key: 'timeline',
    title: '时间线',
    caption: '全家记的记录按天聚成一条流，谁在什么时候记的都写在上面。',
  },
  {
    key: 'reminders',
    title: '提醒',
    caption: '到点的提醒会一直红着，直到家里有人把它点掉。',
  },
  {
    key: 'family',
    title: '家庭',
    caption: '邀请码把爷爷奶奶拉进来，每个人都能记，也都能看。',
  },
]
