import { useEffect, useState } from 'react'
import { addVocab } from '../lib/storage'
import { Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { fetchJson } from '../lib/http'

interface DictEntry {
  word: string
  phonetic?: string
  meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

interface DictResult {
  entry: DictEntry | null
  zhGloss: string // 中文简译（MyMemory 机器翻译兑底）
}

const CACHE_KEY = 'dtl.dictcache'
const CACHE_LIMIT = 500

function readCache(): Record<string, DictResult & { ts: number }> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} }
}
function writeCache(word: string, result: DictResult) {
  try {
    const all = readCache()
    all[word] = { ...result, ts: Date.now() }
    const keys = Object.keys(all)
    if (keys.length > CACHE_LIMIT) {
      keys.sort((a, b) => all[a].ts - all[b].ts)
        .slice(0, keys.length - CACHE_LIMIT)
        .forEach(k => delete all[k])
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}

/** 英英释义查询：dictionaryapi.dev */
function lookupEntry(word: string, signal: AbortSignal): Promise<DictEntry | null> {
  return fetchJson<DictEntry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
    signal,
    timeoutMs: 8_000,
    retries: 1,
  }).then(list => list[0] ?? null)
}

/** 中文简译查询：MyMemory 机器翻译，响应较慢且不稳定，不重试以免拖长等待 */
function lookupZhGloss(word: string, signal: AbortSignal): Promise<string> {
  return fetchJson<{ responseData?: { translatedText?: string } }>(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`,
    { signal, timeoutMs: 6_000, retries: 0 },
  ).then(d => (d?.responseData?.translatedText as string) || '')
}

export default function DictPanel({ word, source, onClose }: {
  word: string
  source?: string
  onClose: () => void
}) {
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [entryState, setEntryState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [zhGloss, setZhGloss] = useState('')
  const [zhState, setZhState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    const key = word.toLowerCase()
    setAdded(false)

    const cached = readCache()[key]
    if (cached) {
      setEntry(cached.entry)
      setEntryState('ok')
      setZhGloss(cached.zhGloss)
      setZhState(cached.zhGloss ? 'ok' : 'error')
      return
    }

    setEntry(null)
    setEntryState('loading')
    setZhGloss('')
    setZhState('loading')

    const controller = new AbortController()
    let entryDone: DictEntry | null | undefined
    let zhDone: string | undefined
    const trySaveCache = () => {
      if (entryDone === undefined || zhDone === undefined) return
      if (entryDone === null && !zhDone) return // 双双失败不缓存，允许下次重试
      writeCache(key, { entry: entryDone, zhGloss: zhDone })
    }

    lookupEntry(word, controller.signal)
      .then(e => { setEntry(e); setEntryState('ok'); entryDone = e; trySaveCache() })
      .catch(() => { if (!controller.signal.aborted) { setEntryState('error'); entryDone = null; trySaveCache() } })

    lookupZhGloss(word, controller.signal)
      .then(g => { setZhGloss(g); setZhState(g ? 'ok' : 'error'); zhDone = g; trySaveCache() })
      .catch(() => { if (!controller.signal.aborted) { setZhState('error'); zhDone = ''; trySaveCache() } })

    return () => controller.abort()
  }, [word])

  const state: 'loading' | 'ok' | 'error' =
    entryState === 'loading' || zhState === 'loading'
      ? (entry || zhGloss ? 'ok' : 'loading')
      : (entry || zhGloss ? 'ok' : 'error')

  const speak = () => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-US'
    speechSynthesis.speak(u)
  }

  const onAdd = () => {
    const meaning = entry?.meanings?.[0]?.definitions?.[0]?.definition
    addVocab({
      word,
      phonetic: entry?.phonetic,
      meaning: meaning
        ? (meaning.length > 120 ? meaning.slice(0, 117) + '...' : meaning)
        : (zhGloss || undefined),
      source,
    })
    setAdded(true)
  }

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="mx-auto max-h-[80%] w-full max-w-lg overflow-y-auto rounded-t-2xl px-4 pt-3 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <SheetTitle className="text-xl font-bold">{word}</SheetTitle>
            {entry?.phonetic && <p className="text-sm text-muted-foreground">{entry.phonetic}</p>}
          </div>
          <Button variant="secondary" size="sm" className="rounded-full" onClick={speak}>
            <Volume2Icon data-icon="inline-start" />发音
          </Button>
        </div>

        {state === 'loading' && <p className="mt-4 text-sm text-muted-foreground">查询中…</p>}
        {state === 'error' && <p className="mt-4 text-sm text-muted-foreground">暂无释义（可能离线）</p>}
        {state === 'ok' && (
          <div className="mt-3 space-y-3">
            {zhState === 'loading' && <p className="text-xs text-muted-foreground">中文翻译加载中…</p>}
            {zhGloss && (
              <p className="rounded-lg bg-primary/8 px-3 py-2 text-sm">
                <span className="mr-1 text-xs text-primary">中文</span>{zhGloss}
              </p>
            )}
            {entryState === 'loading' && <p className="text-xs text-muted-foreground">英文释义加载中…</p>}
            {entry?.meanings.slice(0, 3).map((m, i) => (
              <div key={i}>
                <Badge variant="outline" className="italic text-primary">{m.partOfSpeech}</Badge>
                {m.definitions.slice(0, 2).map((d, j) => (
                  <div key={j} className="mt-1">
                    <p className="text-sm leading-snug">{d.definition}</p>
                    {d.example && <p className="mt-0.5 text-xs italic text-muted-foreground">“{d.example}”</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {source && (
          <p className="mt-3 rounded-lg bg-muted/60 p-2 text-xs leading-snug text-muted-foreground">
            来源：{source}
          </p>
        )}

        <Button onClick={onAdd} disabled={added} className="mt-4 h-11 w-full rounded-xl text-sm font-semibold">
          {added ? '已加入生词本' : '＋ 加入生词本'}
        </Button>
      </SheetContent>
    </Sheet>
  )
}
