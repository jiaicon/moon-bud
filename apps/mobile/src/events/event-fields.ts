import type { EventType } from '@moonbud/shared'
import type { ThemeTokens } from '../theme/tokens'

export type FieldKind = 'text' | 'number' | 'select' | 'datetime' | 'time' | 'textarea'

export interface FieldSpec {
  /** 必须与 shared payload schema 的键完全同名：表单直接产出 payload，中间没有映射层。 */
  name: string
  label: string
  kind: FieldKind
  options?: { value: string; label: string }[]
  required: boolean
  unit?: string
  placeholder?: string
}

export interface EventTypeMeta {
  label: string
  icon: string
  primaryColorToken: keyof ThemeTokens
  requiredFields: string[]
  duplicateWindowMinutes: number
}

const opt = (value: string, label: string) => ({ value, label })

export const EVENT_TYPE_META: Record<EventType, EventTypeMeta> = {
  feeding: { label: '喂奶', icon: '🍼', primaryColorToken: 'primary', requiredFields: ['method'], duplicateWindowMinutes: 90 },
  sleep: { label: '睡眠', icon: '😴', primaryColorToken: 'info', requiredFields: [], duplicateWindowMinutes: 60 },
  diaper: { label: '大小便', icon: '🧷', primaryColorToken: 'warning', requiredFields: ['kind'], duplicateWindowMinutes: 60 },
  solid: { label: '辅食', icon: '🥣', primaryColorToken: 'success', requiredFields: ['food'], duplicateWindowMinutes: 60 },
  medicine: { label: '用药', icon: '💊', primaryColorToken: 'error', requiredFields: ['name', 'dose'], duplicateWindowMinutes: 120 },
  temperature: { label: '体温', icon: '🌡️', primaryColorToken: 'error', requiredFields: ['celsius'], duplicateWindowMinutes: 180 },
  growth: { label: '生长发育', icon: '📏', primaryColorToken: 'success', requiredFields: [], duplicateWindowMinutes: 60 },
  milestone: { label: '里程碑', icon: '⭐', primaryColorToken: 'primary', requiredFields: ['title'], duplicateWindowMinutes: 60 },
}

const FIELDS: Record<EventType, FieldSpec[]> = {
  feeding: [
    {
      name: 'method',
      label: '方式',
      kind: 'select',
      required: true,
      options: [opt('breast', '母乳'), opt('bottle', '瓶喂'), opt('formula', '配方奶')],
    },
    {
      name: 'side',
      label: '侧别',
      kind: 'select',
      required: false,
      options: [opt('left', '左'), opt('right', '右'), opt('both', '双侧')],
    },
    { name: 'amountMl', label: '奶量', kind: 'number', required: false, unit: 'ml', placeholder: '如 120' },
    { name: 'durationMin', label: '时长', kind: 'number', required: false, unit: '分钟', placeholder: '如 15' },
  ],
  sleep: [
    {
      name: 'quality',
      label: '睡眠质量',
      kind: 'select',
      required: false,
      options: [opt('good', '好'), opt('fair', '一般'), opt('poor', '差')],
    },
  ],
  diaper: [
    {
      name: 'kind',
      label: '类型',
      kind: 'select',
      required: true,
      options: [opt('pee', '小便'), opt('poo', '大便'), opt('mixed', '混合')],
    },
    { name: 'color', label: '颜色', kind: 'text', required: false, placeholder: '如 黄色' },
    { name: 'texture', label: '性状', kind: 'text', required: false, placeholder: '如 糊状' },
  ],
  solid: [
    { name: 'food', label: '食物', kind: 'text', required: true, placeholder: '如 米粉' },
    { name: 'amountDesc', label: '量', kind: 'text', required: false, placeholder: '如 半碗' },
    { name: 'reaction', label: '反应', kind: 'textarea', required: false, placeholder: '有无过敏、拒食等' },
  ],
  medicine: [
    { name: 'name', label: '药品名', kind: 'text', required: true, placeholder: '如 维生素D' },
    { name: 'dose', label: '剂量', kind: 'text', required: true, placeholder: '如 400IU' },
    {
      name: 'route',
      label: '用法',
      kind: 'select',
      required: false,
      options: [opt('oral', '口服'), opt('topical', '外用'), opt('other', '其他')],
    },
  ],
  temperature: [
    // 30–45 ℃ 是人体范围（与 shared 同源），华氏度误填会被挡住，所以范围写进占位符。
    { name: 'celsius', label: '体温', kind: 'number', required: true, unit: '℃', placeholder: '36.5（30–45）' },
    {
      name: 'site',
      label: '测量部位',
      kind: 'select',
      required: false,
      options: [opt('axillary', '腋下'), opt('ear', '耳'), opt('forehead', '额温'), opt('rectal', '肛门')],
    },
  ],
  growth: [
    { name: 'weightKg', label: '体重', kind: 'number', required: false, unit: 'kg', placeholder: '如 7.2' },
    { name: 'heightCm', label: '身长', kind: 'number', required: false, unit: 'cm', placeholder: '如 68' },
    { name: 'headCm', label: '头围', kind: 'number', required: false, unit: 'cm', placeholder: '如 44' },
  ],
  milestone: [
    { name: 'title', label: '事件', kind: 'text', required: true, placeholder: '如 第一次翻身' },
    { name: 'description', label: '描述', kind: 'textarea', required: false, placeholder: '想记下来的细节' },
  ],
}

export function fieldsFor(type: EventType): FieldSpec[] {
  return FIELDS[type]
}

export function requiredFieldCount(type: EventType): number {
  return fieldsFor(type).filter((f) => f.required).length
}

/**
 * growth 的"至少填一项"是 schema 的 refine，不是某个字段的 required —— 加必填会破坏
 * "必填 ≤ 2"，所以只在 UI 上非阻断地提醒。
 */
export const NON_BLOCKING_NOTICES: Partial<Record<EventType, string>> = {
  growth: '体重、身高、头围至少填一项',
}
