/**
 * 客户端预生成的记录 id。离线创建必须带上它，恢复后重放才不会凭空多出第二条：
 * 后端 EventsService.create 认这个 id 做幂等（同一 id 已在库里就原样返回那条）。
 * 所以 id 必须在"第一次发之前就定好"，而不是等失败再补——失败那趟可能已经写进库、
 * 只是响应没回来，届时补出来的新 id 反而绕过了幂等。
 */
export function uuidV4(): string {
  const bytes = new Uint8Array(16)
  const g = globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  // 版本位（第 7 字节高 4 位）置 4，变体位（第 9 字节高 2 位）置 10xx：@IsUUID 会校验。
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 16; i += 1) hex.push(bytes[i].toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
