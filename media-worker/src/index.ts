const MEDIA_PATH = /^\/v1\/(standard|high)\/([a-z0-9_-]+\.m4a)$/

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Match, If-None-Match',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, ETag',
  }
}

function plain(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() },
  })
}

function objectHeaders(object: R2Object) {
  const headers = new Headers(corsHeaders())
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

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain('Method Not Allowed', 405)

    const match = new URL(request.url).pathname.match(MEDIA_PATH)
    if (!match) return plain('Not Found', 404)
    const key = `v1/${match[1]}/${match[2]}`

    try {
      if (request.method === 'HEAD') {
        const object = await env.AUDIO.head(key)
        if (!object) return plain('Not Found', 404)
        const headers = objectHeaders(object)
        headers.set('Content-Length', String(object.size))
        return new Response(null, { status: 200, headers })
      }

      const object = await env.AUDIO.get(key, {
        range: request.headers,
        onlyIf: request.headers,
      })
      if (!object) return plain('Not Found', 404)

      const headers = objectHeaders(object)
      if (!('body' in object)) return new Response(null, { status: 304, headers })

      const rangeHeader = request.headers.get('Range')
      const parsed = rangeHeader ? parseRange(rangeHeader, object.size) : null

      let status = 200
      if (parsed) {
        headers.set('Content-Range', `bytes ${parsed.offset}-${parsed.offset + parsed.length - 1}/${object.size}`)
        headers.set('Content-Length', String(parsed.length))
        status = 206
      } else {
        headers.set('Content-Length', String(object.size))
      }
      return new Response(object.body, { status, headers })
    } catch (error) {
      console.error('media request failed', {
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      })
      return plain('Media request failed', 500)
    }
  },
} satisfies ExportedHandler<Env>
