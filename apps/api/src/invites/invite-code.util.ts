import { randomInt } from 'node:crypto'

/**
 * 邀请码字母表：31 个字符，去掉 O/0/I/1/L。
 * 这些字符在家里人口头转述或手抄时最容易互相认错，而邀请码本来就是靠嘴传的。
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 8

export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]
  }
  return code
}
