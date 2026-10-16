import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp } from './utils/db'

/**
 * 这个 spec 存在的理由：H5 预览（pnpm dev:h5，源是 localhost:5173）与后端不同源，
 * 浏览器的预检请求一旦被拒，前端只会看到一句"请求失败"，而后端日志里什么都没有。
 * 没有 e2e 覆盖时，CORS 是那种"只有用户第一次连后端才会发现"的缺失配置。
 */
describe('跨源策略', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('浏览器预检能穿过去，H5 预览才连得上后端', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(res.headers['access-control-allow-methods']).toContain('PATCH')
  })

  it('响应回显来源但不带凭据：鉴权走 Authorization 头，不给 CSRF 留面', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').set('Origin', 'http://localhost:5173')

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })
})
