import { parseUIMetrics } from '../../src/lib/ui-metrics'

/** 小批量诊断直接进入 Pages 实时日志，复用现有基础设施。 */
export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  const origin = request.headers.get('Origin')
  if (origin !== new URL(request.url).origin) return new Response(null, { status: 403 })
  if (Number(request.headers.get('Content-Length')) > 4096) return new Response(null, { status: 413 })
  try {
    const text = await request.text()
    if (text.length > 4096) return new Response(null, { status: 413 })
    const metrics = parseUIMetrics(JSON.parse(text))
    if (!metrics) return new Response(null, { status: 400 })
    console.info('ui-performance', metrics)
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return new Response(null, { status: 400 })
  }
}
