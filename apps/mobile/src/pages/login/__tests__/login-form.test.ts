import { describe, expect, it } from 'vitest'
import { validateLoginForm } from '../use-login-form'

describe('validateLoginForm', () => {
  it('注册时合法输入无错误', () => {
    expect(validateLoginForm({ mode: 'register', username: 'mama2024', password: 'pass12345', nickname: '妈妈' })).toEqual({})
  })

  it('账号不合规给出中文提示', () => {
    const e = validateLoginForm({ mode: 'register', username: 'ab', password: 'pass12345', nickname: '妈妈' })
    expect(e.username).toContain('4')
  })

  it('拒绝中文账号', () => {
    expect(validateLoginForm({ mode: 'register', username: '妈妈2024', password: 'pass12345', nickname: '妈妈' }).username).toBeTruthy()
  })

  it('密码过短给出提示，且提示里带最短长度', () => {
    const e = validateLoginForm({ mode: 'register', username: 'mama2024', password: 'short', nickname: '妈妈' })
    expect(e.password).toContain('8')
  })

  it('注册时昵称必填，登录时不校验昵称', () => {
    expect(validateLoginForm({ mode: 'register', username: 'mama2024', password: 'pass12345', nickname: '' }).nickname).toBeTruthy()
    expect(validateLoginForm({ mode: 'login', username: 'mama2024', password: 'pass12345' }).nickname).toBeUndefined()
  })

  it('加入模式必须填邀请码', () => {
    expect(validateLoginForm({ mode: 'join', username: 'mama2024', password: 'pass12345', nickname: '妈妈', inviteCode: '' }).inviteCode).toBeTruthy()
    expect(validateLoginForm({ mode: 'join', username: 'mama2024', password: 'pass12345', nickname: '妈妈', inviteCode: 'ABCD2345' })).toEqual({})
  })

  it('登录模式只校验账号与密码，不因昵称为空报错', () => {
    expect(validateLoginForm({ mode: 'login', username: 'mama2024', password: 'pass12345' })).toEqual({})
  })

  it('多个字段同时不合规时一次性全部返回', () => {
    const e = validateLoginForm({ mode: 'register', username: 'x', password: 'y', nickname: '' })
    expect(Object.keys(e).sort()).toEqual(['nickname', 'password', 'username'])
  })
})
