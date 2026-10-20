import type { ChildDto, EventDto } from '@moonbud/shared'
import { EVENT_TYPE_META } from './event-fields'
import { eventDetail } from './format-event'
import { wallStamp } from '../utils/wall-time'

/**
 * 家庭记录导出 CSV（spec 之外补的便利项：家长想把历史拉进表格自己算，
 * 或只是想要一份"数据是我的"的凭据）。纯字符串函数，不碰网络也不碰下载，
 * 好让区间、时区、转义这些真正会出错的地方都能被单测钉住。
 */

const pad = (n: number) => String(n).padStart(2, '0')

const HEADERS = ['时间', '孩子', '类型', '详情', '记录人', '备注'] as const

/**
 * RFC 4180 转义：只要字段里有逗号、双引号、或换行，就整字段裹双引号，
 * 内部的双引号翻倍。备注是自由文本，这三样都可能碰上。
 */
function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function rowOf(event: EventDto, childName: string, timezone: string): string {
  const at = Date.parse(event.occurredAt)
  // 时刻读不出来（脏数据）时不留空、也不抛：写个占位让这一行仍在这份表里，
  // 免得整份导出因为一条坏数据少一行而说不清。
  const stamp = Number.isNaN(at) ? null : wallStamp(timezone, new Date(at))
  const when = stamp ? `${stamp.year}-${pad(stamp.month)}-${pad(stamp.day)} ${stamp.clock}` : '未知时间'
  const cells = [
    when,
    childName,
    EVENT_TYPE_META[event.type]?.label ?? event.type,
    eventDetail(event),
    event.createdByNickname,
    event.note ?? '',
  ]
  return cells.map((c) => escapeCell(c)).join(',')
}

/**
 * 把一页记录序列化成 CSV。前置 UTF-8 BOM：Excel 光看字节猜不出这是 UTF-8，
 * 没有 BOM 中文会直接花屏——导出一份看不懂的表不如不导。
 * 行分隔用 CRLF，这是 RFC 4180 与 Excel 都认的标准。
 */
export function exportCsv(events: EventDto[], children: ChildDto[], timezone: string): string {
  const nameOf = new Map(children.map((c) => [c.id, c.name]))
  const lines = [HEADERS.join(',')]
  for (const event of events) {
    // 孩子删过了、或这页数据里混了别家的孩子：对不上号就写"未知孩子"，
    // 留空会让人误以为这条记录本来就没归属。
    const childName = nameOf.get(event.childId) ?? '未知孩子'
    lines.push(rowOf(event, childName, timezone))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

/**
 * 文件名里带上区间名与导出当天（账号时区）：一个家庭可能连着导好几份，
 * 下到"月芽-近 7 天-20261020.csv"才知道各是哪一段。
 */
export function csvFileName(rangeLabel: string, now: Date, timezone: string): string {
  const stamp = wallStamp(timezone, now)
  const scope = rangeLabel || '全部记录'
  return `月芽-${scope}-${stamp.year}${pad(stamp.month)}${pad(stamp.day)}.csv`
}

/**
 * 把 CSV 文本交给系统落地。H5 走 Blob + <a download>（浏览器自己弹下载，成功不言自明）；
 * App 走 plus.io 写到 `_doc/` 再用 `plus.runtime.openFile` 交给系统选择器，
 * 让用户存去文件/云盘或发给想发的人。
 * 内容里的 BOM 必须留着：那是 Excel 认出 UTF-8 的唯一线索。
 *
 * 两边各自整块条件编译——鸿蒙等没有 plus 的平台里，`if (typeof plus …)` 挡不住编译期
 * 对 plus 的引用，只能靠 `#ifdef` 在产物里删掉这段（与 notifications/local-notify.ts 同理）。
 */
export function saveCsv(name: string, content: string): void {
  // #ifdef H5
  saveCsvInH5(name, content)
  // #endif

  // #ifdef APP-PLUS
  saveCsvInApp(name, content)
  // #endif
}

// #ifdef H5
function saveCsvInH5(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻回收也行：click 已经把 blob 交给浏览器下载队列了。
  URL.revokeObjectURL(url)
}
// #endif

// #ifdef APP-PLUS
function saveCsvInApp(name: string, content: string): void {
  plus.io.resolveLocalFileSystemURL(
    '_doc/',
    (dir) => {
      dir.getFile(
        name,
        { create: true },
        (entry) => {
          entry.createWriter((writer) => {
            writer.onwrite = () => {
              // 落到 _doc/ 后交给系统：没有 CSV 关联应用时 Android 会弹选择器，
              // 用户自己挑存到文件/云盘/发给谁。share 的文件类型这套类型定义里不支持，
              // openFile 是能被类型认下来的那条路。
              plus.runtime.openFile(plus.io.convertLocalFileSystemURL(entry.toLocalURL()), {}, () =>
                uni.showToast({ title: '打不开导出的文件', icon: 'none' }),
              )
            }
            writer.write(content)
          })
        },
        () => uni.showToast({ title: '导出失败', icon: 'none' }),
      )
    },
    () => uni.showToast({ title: '导出失败', icon: 'none' }),
  )
}
// #endif
