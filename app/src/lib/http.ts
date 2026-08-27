export class HttpError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

interface FetchJsonOptions {
  signal?: AbortSignal
  timeoutMs?: number
  retries?: number
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    const abort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { signal, timeoutMs = 12_000, retries = 1 } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const relayAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', relayAbort, { once: true })
    const timer = window.setTimeout(() => controller.abort('timeout'), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new HttpError(`请求失败（HTTP ${response.status}）`, response.status)
      }
      return await response.json() as T
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      lastError = error
      const status = error instanceof HttpError ? error.status : 0
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500
      if (!retryable || attempt >= retries) break
      await wait(350 * 2 ** attempt, signal)
    } finally {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', relayAbort)
    }
  }

  if (lastError instanceof DOMException && lastError.name === 'AbortError') {
    throw new HttpError('请求超时，请检查网络后重试')
  }
  if (lastError instanceof Error) throw lastError
  throw new HttpError('请求失败，请检查网络后重试')
}
