import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../src/lib/http'

afterEach(() => vi.unstubAllGlobals())

describe('fetchJson', () => {
  it('超时后返回可识别的超时错误', async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJson('/slow.json', { timeoutMs: 1, retries: 0 }))
      .rejects.toThrow('请求超时')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
