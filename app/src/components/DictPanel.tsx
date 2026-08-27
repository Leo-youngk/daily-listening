import { useEffect, useState } from 'react'
import { addVocab } from '../lib/storage'
import { Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

interface DictEntry {
  word: string
  phonetic?: string
  meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

interface DictResult {
  entry: DictEntry | null
  zhGloss: string // 中文简译（MyMemory 机器翻译兑底）
}

/** 查词：dictionaryapi.dev 英英释义 + MyMemory 中文简译，双通道提高可用性 */
async function lookup(word: string): Promise<DictResult> {
  const [enRes, zhRes] = await Promise.allSettled([
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      .then(r => { if (!r.ok) throw new Error('nf'); return r.json() }),
    fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`)
      .then(r => r.json())
      .then(d => (d?.responseData?.translatedText as string) || ''),
  ])
  const entry = enRes.status === 'fulfilled' ? (enRes.value as DictEntry[])[0] ?? null : null
  const zhGloss = zhRes.status === 'fulfilled' ? (zhRes.value as string) : ''
  if (!entry && !zhGloss) throw new Error('lookup failed')
  return { entry, zhGloss }
}

export default function DictPanel({ word, source, onClose }: {
  word: string
  source?: string
  onClose: () => void
}) {
  const [data, setData] = useState<DictResult | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    setState('loading')
    setData(null)
    lookup(word)
      .then(r => { setData(r); setState('ok') })
      .catch(() => setState('error'))
  }, [word])

  const speak = () => {
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-US'
    speechSynthesis.speak(u)
  }

  const onAdd = () => {
    const meaning = data?.entry?.meanings?.[0]?.definitions?.[0]?.definition
    addVocab({
      word,
      phonetic: data?.entry?.phonetic,
      meaning: meaning
        ? (meaning.length > 120 ? meaning.slice(0, 117) + '...' : meaning)
        : (data?.zhGloss || undefined),
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
            {data?.entry?.phonetic && <p className="text-sm text-muted-foreground">{data.entry.phonetic}</p>}
          </div>
          <Button variant="secondary" size="sm" className="rounded-full" onClick={speak}>
            <Volume2Icon data-icon="inline-start" />发音
          </Button>
        </div>

        {state === 'loading' && <p className="mt-4 text-sm text-muted-foreground">查询中…</p>}
        {state === 'error' && <p className="mt-4 text-sm text-muted-foreground">暂无释义（可能离线）</p>}
        {state === 'ok' && data && (
          <div className="mt-3 space-y-3">
            {data.zhGloss && (
              <p className="rounded-lg bg-primary/8 px-3 py-2 text-sm">
                <span className="mr-1 text-xs text-primary">中文</span>{data.zhGloss}
              </p>
            )}
            {data.entry?.meanings.slice(0, 3).map((m, i) => (
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
