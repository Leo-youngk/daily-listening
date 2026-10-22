import { afterEach, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/ui-metrics'

const valid = {
  version: 'abc1234', page: 'talk', theme: 'dark', inputs: 3, inputPaintMax: 31.5,
  eventDurationMax: 32, scrollFrames: 80, slowFrames: 1, frameMax: 56, longTasks: 0, longTaskMax: 0,
}
const send = (data: unknown, origin = 'https://daily-listening-e7k.pages.dev') => onRequestPost({
  request: new Request('https://daily-listening-e7k.pages.dev/api/ui-metrics', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }),
})
afterEach(() => vi.restoreAllMocks())

it('性能汇总进入日志，用户内容等额外字段不会写入日志', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  expect((await send({ ...valid, text: 'private text', url: 'private url' })).status).toBe(204)
  expect(log).toHaveBeenCalledExactlyOnceWith('ui-performance', { ...valid, inputPaintMax: 32 })
})

it('拒绝跨站来源、无效页面和非法耗时', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  expect((await send(valid, 'https://example.com')).status).toBe(403)
  expect((await send({ ...valid, page: 'arbitrary text' })).status).toBe(400)
  expect((await send({ ...valid, frameMax: -1 })).status).toBe(400)
  expect((await send({ ...valid, frameMax: 'slow' })).status).toBe(400)
  expect(log).not.toHaveBeenCalled()
})
