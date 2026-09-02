import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  detail: string
}

/**
 * 全局错误边界。
 *
 * PWA 装到桌面后没有地址栏，渲染期异常一旦白屏，用户除了删掉重装没有别的出路。
 * 这里兜住异常并给出"重载 / 清缓存重载"两条自救路径，同时把堆栈折叠展示——
 * 真机上出问题时能直接截图反馈，不用连电脑看控制台。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, detail: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render crashed', error, info)
    this.setState({ detail: `${error.stack ?? error.message}\n${info.componentStack ?? ''}`.trim() })
  }

  private reload = () => {
    window.location.reload()
  }

  /** 清掉运行时缓存 + Service Worker 再重载：应对旧版本资源与新版本代码对不上的情况 */
  private hardReload = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(key => caches.delete(key)))
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(reg => reg.unregister()))
      }
    } catch (error) {
      console.error('hard reload cleanup failed', error)
    }
    window.location.reload()
  }

  render() {
    const { error, detail } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-2xl">
          ⚠️
        </div>
        <div className="space-y-1.5">
          <p className="text-base font-semibold">页面出错了</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            这是应用自身的问题，不是你的操作导致的。<br />
            先试试重新加载；还不行就清一次缓存。
          </p>
        </div>

        <div className="flex w-full max-w-64 flex-col gap-2">
          <button
            onClick={this.reload}
            className="h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            重新加载
          </button>
          <button
            onClick={() => { void this.hardReload() }}
            className="h-10 rounded-full bg-secondary text-sm font-semibold text-secondary-foreground active:opacity-80"
          >
            清除缓存并重载
          </button>
        </div>

        {detail && (
          <details className="w-full text-left">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">
              查看错误详情
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-muted p-2.5 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {detail}
            </pre>
          </details>
        )}

        <p className="text-[11px] tabular-nums text-muted-foreground">
          版本 {__BUILD_SHA__} · {__BUILD_TIME__}
        </p>
      </div>
    )
  }
}
