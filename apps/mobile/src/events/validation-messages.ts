/**
 * zod 的默认文案是英文，而这个应用只给不会英文的家长用。
 * shared 的 schema 是数字的唯一来源（我们只翻译措辞、不复制约束），
 * 所以这里做的是文案映射，不是第二套校验。
 */
const PATTERNS: { re: RegExp; zh: (m: RegExpMatchArray) => string }[] = [
  { re: /^Number must be less than or equal to (-?[\d.]+)$/, zh: (m) => `不能大于 ${m[1]}` },
  { re: /^Number must be greater than or equal to (-?[\d.]+)$/, zh: (m) => `不能小于 ${m[1]}` },
  { re: /^Number must be less than (-?[\d.]+)$/, zh: (m) => `必须小于 ${m[1]}` },
  { re: /^Number must be greater than (-?[\d.]+)$/, zh: (m) => `必须大于 ${m[1]}` },
  { re: /^Number must be an integer$/, zh: () => '请填写整数' },
  { re: /^Number must be a number$/, zh: () => '请填写数字' },
  { re: /^String must contain at least \d+ character/, zh: () => '不能为空' },
  { re: /^String must contain at most \d+ character/, zh: () => '内容过长' },
  { re: /^Required$/, zh: () => '请填写' },
  { re: /^Invalid date$/, zh: () => '日期格式不正确' },
  { re: /^Invalid.*$/, zh: () => '格式不正确' },
]

export function zhValidationMessage(message: string): string {
  const text = message.trim()
  if (/[一-龥]/.test(text)) return text
  for (const { re, zh } of PATTERNS) {
    const matched = text.match(re)
    if (matched) return zh(matched)
  }
  return '格式不正确'
}
