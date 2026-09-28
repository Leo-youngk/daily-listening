/**
 * 同源音频：/audio/v1/standard/<slug>.mp3、/audio/v1/high/<slug>.m4a、/audio/v1/clips/<slug>/<句子下标>-<起点厘秒>.m4a
 *
 * 音频和页面走同一个域名，打开 App 时建好的连接直接复用，首播不再单独做一次 TLS 握手
 * （单独的 workers.dev 音频域名实测握手 0.7~3.8 秒）。对象由 scripts/deploy_audio_r2.py、cut_clips.py 上传。
 * 地址带 v1/ 版本前缀，内容不变，所以给一年 immutable 缓存。
 */
interface Env {
  /** wrangler.jsonc 的 r2_buckets 绑定 */
  AUDIO: R2Bucket
}

type Context = { request: Request; env: Env }

const PATHS = [
  /^\/audio\/(v1\/standard\/[a-z0-9_-]+\.mp3)$/,
  /^\/audio\/(v1\/high\/[a-z0-9_-]+\.m4a)$/,
  /^\/audio\/(v1\/clips\/[a-z0-9_-]+\/\d+-\d+\.m4a)$/,
]

function objectKey(pathname: string): string | null {
  for (const pattern of PATHS) {
    const match = pathname.match(pattern)
    if (match) return match[1]
  }
  return null
}

function plain(message: string, status: number) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function objectHeaders(object: R2Object) {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', object.httpEtag)
  return headers
}

function parseRange(rangeHeader: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const [, startStr, endStr] = match
  if (startStr === '' && endStr === '') return null
  if (startStr === '') {
    const suffixLength = Math.min(parseInt(endStr, 10), size)
    return { offset: size - suffixLength, length: suffixLength }
  }
  const offset = parseInt(startStr, 10)
  if (offset >= size) return null
  const end = endStr === '' ? size - 1 : Math.min(parseInt(endStr, 10), size - 1)
  return { offset, length: end - offset + 1 }
}

export const onRequestHead = async ({ request, env }: Context): Promise<Response> => {
  const key = objectKey(new URL(request.url).pathname)
  if (!key) return plain('Not Found', 404)
  const object = await env.AUDIO.head(key)
  if (!object) return plain('Not Found', 404)
  const headers = objectHeaders(object)
  headers.set('Content-Length', String(object.size))
  return new Response(null, { status: 200, headers })
}

export const onRequestGet = async ({ request, env }: Context): Promise<Response> => {
  const key = objectKey(new URL(request.url).pathname)
  if (!key) return plain('Not Found', 404)
  try {
    const object = await env.AUDIO.get(key, { range: request.headers, onlyIf: request.headers })
    if (!object) return plain('Not Found', 404)

    const headers = objectHeaders(object)
    if (!('body' in object)) return new Response(null, { status: 304, headers })

    const rangeHeader = request.headers.get('Range')
    const parsed = rangeHeader ? parseRange(rangeHeader, object.size) : null
    if (parsed) {
      headers.set('Content-Range', `bytes ${parsed.offset}-${parsed.offset + parsed.length - 1}/${object.size}`)
      headers.set('Content-Length', String(parsed.length))
      return new Response(object.body, { status: 206, headers })
    }
    headers.set('Content-Length', String(object.size))
    return new Response(object.body, { status: 200, headers })
  } catch (error) {
    console.error('audio request failed', { key, error: error instanceof Error ? error.message : String(error) })
    return plain('Audio request failed', 500)
  }
}
