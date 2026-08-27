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

export function navigate(path: string) {
  location.hash = path
}

export function parseRoute(hash: string): { page: string; param: string } {
  // 形如 /talk/xxx、/library、/vocab、/me、/
  const parts = hash.split('/').filter(Boolean)
  return { page: parts[0] || 'discover', param: parts.slice(1).join('/') }
}
