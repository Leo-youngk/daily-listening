import { useEffect } from 'react'
import { registerSW } from 'virtual:pwa-register'

const CHECK_INTERVAL = 1000 * 60 * 60

export default function UpdateBanner() {
  useEffect(() => {
    let timer: number | null = null
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        // 注册动作本身会检查一次；长时间保持打开时每小时再检查一次。
        timer = window.setInterval(() => {
          void registration.update().catch(() => {
            // 网络暂不可用时保留当前版本，下一个周期再检查。
          })
        }, CHECK_INTERVAL)
      },
    })
    return () => {
      if (timer !== null) window.clearInterval(timer)
    }
  }, [])

  return null
}
