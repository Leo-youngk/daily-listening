import { useEffect, useState } from 'react'

/** 极简 hash 路由：返回当前 hash（不含 #）及跳转方法 */
export function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/')
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash.slice(1) || '/')
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export function navigate(path: string, params?: Record<string, string>) {
  let hash = path
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) hash += `?${qs}`
  }
  location.hash = hash
}

export function parseRoute(hash: string): { page: string; param: string; query: URLSearchParams } {
  const [pathname, search] = hash.split('?')
  const parts = pathname.split('/').filter(Boolean)
  return {
    page: parts[0] || 'discover',
    param: parts.slice(1).join('/'),
    query: new URLSearchParams(search || ''),
  }
}
