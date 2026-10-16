import { z } from 'zod'

/**
 * 备注上限。前端 textarea 的 maxlength 与后端校验必须同源，
 * 否则会出现"前端允许输入、后端拒绝保存"的体验断裂。
 */
export const NOTE_MAX_LENGTH = 500

const amountMl = z.number().positive().max(2000)
const durationMin = z.number().int().positive().max(600)

const feedingSchema = z
  .object({
    method: z.enum(['breast', 'bottle', 'formula']),
    side: z.enum(['left', 'right', 'both']).optional(),
    amountMl: amountMl.optional(),
    durationMin: durationMin.optional(),
  })
  .strict()

const sleepSchema = z
  .object({
    quality: z.enum(['good', 'fair', 'poor']).optional(),
  })
  .strict()

const diaperSchema = z
  .object({
    kind: z.enum(['pee', 'poo', 'mixed']),
    color: z.string().max(50).optional(),
    texture: z.string().max(50).optional(),
  })
  .strict()

const solidSchema = z
  .object({
    food: z.string().min(1).max(100),
    amountDesc: z.string().max(100).optional(),
    reaction: z.string().max(200).optional(),
  })
  .strict()

const medicineSchema = z
  .object({
    name: z.string().min(1).max(100),
    dose: z.string().min(1).max(50),
    route: z.string().max(50).optional(),
  })
  .strict()

/**
 * 30–45 ℃ 是人体体温的物理范围。华氏度输入（如 98.6）会被这条拦住，
 * 而不是被当成 98.6 ℃ 存进数据库。
 */
const temperatureSchema = z
  .object({
    celsius: z.number().min(30).max(45),
    site: z.enum(['axillary', 'ear', 'forehead', 'rectal']).optional(),
  })
  .strict()

const growthSchema = z
  .object({
    weightKg: z.number().positive().max(60).optional(),
    heightCm: z.number().positive().max(200).optional(),
    headCm: z.number().positive().max(80).optional(),
  })
  .strict()
  .refine(
    (v) => v.weightKg !== undefined || v.heightCm !== undefined || v.headCm !== undefined,
    { message: '体重、身高、头围至少填一项' },
  )

const milestoneSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().max(NOTE_MAX_LENGTH).optional(),
  })
  .strict()

export const EVENT_TYPES = [
  'feeding',
  'sleep',
  'diaper',
  'solid',
  'medicine',
  'temperature',
  'growth',
  'milestone',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/**
 * 用 Record<EventType, …> 约束：漏掉任何一种记录类型都会在编译期报错，
 * 而不是等到运行时才发现某个类型没有校验规则。
 */
export const eventPayloadSchemas: Record<EventType, z.ZodTypeAny> = {
  feeding: feedingSchema,
  sleep: sleepSchema,
  diaper: diaperSchema,
  solid: solidSchema,
  medicine: medicineSchema,
  temperature: temperatureSchema,
  growth: growthSchema,
  milestone: milestoneSchema,
}

export type FeedingPayload = z.infer<typeof feedingSchema>
export type SleepPayload = z.infer<typeof sleepSchema>
export type DiaperPayload = z.infer<typeof diaperSchema>
export type SolidPayload = z.infer<typeof solidSchema>
export type MedicinePayload = z.infer<typeof medicineSchema>
export type TemperaturePayload = z.infer<typeof temperatureSchema>
export type GrowthPayload = z.infer<typeof growthSchema>
export type MilestonePayload = z.infer<typeof milestoneSchema>

export type EventPayload =
  | FeedingPayload
  | SleepPayload
  | DiaperPayload
  | SolidPayload
  | MedicinePayload
  | TemperaturePayload
  | GrowthPayload
  | MilestonePayload

export type ValidationResult =
  | { ok: true; data: EventPayload }
  | { ok: false; errors: string[] }

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * 校验一条记录的 payload。数据库存的是 JSONB，本身不保证结构，
 * 因此这一层是"记录数据半年后不烂掉"的唯一保障，不是可选项。
 */
export function validateEventPayload(type: EventType, payload: unknown): ValidationResult {
  const schema = eventPayloadSchemas[type]
  if (!schema) {
    return { ok: false, errors: [`未知的记录类型: ${String(type)}`] }
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    }
  }
  return { ok: true, data: parsed.data as EventPayload }
}

/** 返回 null 表示通过（未填写则无需校验），返回 ValidationResult 表示不通过。 */
export function validateNote(note: string | undefined | null): ValidationResult | null {
  if (note === undefined || note === null) return null
  if (note.length > NOTE_MAX_LENGTH) {
    return { ok: false, errors: [`note: 备注不能超过 ${NOTE_MAX_LENGTH} 字`] }
  }
  return null
}
