import { useEffect, useState } from 'react'
import { STORAGE_ERROR_EVENT } from '../lib/storage'

export default function StorageAlert() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onError = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail)
      window.setTimeout(() => setMessage(''), 6000)
    }
    window.addEventListener(STORAGE_ERROR_EVENT, onError)
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, onError)
  }, [])

  if (!message) return null

  return (
    <div className="safe-top pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto max-w-lg px-3 pb-2">
      <div className="glass rounded-xl px-3 py-2 text-[13px] leading-snug text-destructive shadow-lg ring-1 ring-destructive/25">
        {message}
      </div>
    </div>
  )
}
