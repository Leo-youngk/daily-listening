import { useEffect, useState } from 'react'
import { addVocab } from '../lib/storage'
import { Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { lookupContext, lookupLocal, readCachedSense, senseCacheKeyOf } from '../lib/dict'
import type { DictEntry, LookupRequest, LookupResult } from '../lib/lookup'

export interface DictTarget extends LookupRequest {}

type ContextState = 'idle' | 'loading' | 'ok' | 'degraded'

export default function DictPanel({ target, onClose }: { target: DictTarget; onClose: () => void }) {
  const [local, setLocal] = useState<{ term: string; entry?: DictEntry } | null>(null)
  const [localState, setLocalState] = useState<'loading' | 'done'>('loading')
  const [sense, setSense] = useState<LookupResult | null>(null)
  const [contextState, setContextState] = useState<ContextState>('loading')
  const [added, setAdded] = useState<'idle' | 'added' | 'exists' | 'failed'>('idle')

  const { word, sentence, wordIndex } = target

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    setLocal(null)
    setLocalState('loading')
    setSense(null)
    setAdded('idle')

    void lookupLocal(sentence, wordIndex).then(result => {
      if (!alive) return
      setLocal({ term: result.term, entry: result.entry })
      setLocalState('done')
    })

    const cached = readCachedSense(senseCacheKeyOf(target))
    if (cached) {
      setSense(cached)
      setContextState('ok')
      return () => { alive = false; controller.abort() }
    }

    setContextState('loading')
    lookupContext(target, controller.signal)
      .then(result => {
        if (!alive) return
        setSense(result)
        setContextState(result.source === 'ai' && result.contextMeaning ? 'ok' : 'degraded')
      })
      .catch(error => {
        if (!alive || controller.signal.aborted) return
        console.error('context lookup failed', error)
        setContextState('degraded')
      })

    return () => { alive = false; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, sentence, wordIndex])

  const headword = sense?.term ?? local?.term ?? word
  const phonetic = sense?.phonetic || local?.entry?.ph || ''
  // 上下文义项优先，其余常用义项来自本地 ECDICT
  const otherMeanings = sense?.otherMeanings?.length
    ? sense.otherMeanings
    : (local?.entry?.senses ?? []).map(s => ({ partOfSpeech: s.pos.replace(/\.$/, ''), zh: s.zh }))

  const speak = () => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(headword)
    u.lang = 'en-US'
    speechSynthesis.speak(u)
  }

  const onAdd = () => {
    const meaning = sense?.contextMeaning || otherMeanings[0]?.zh || ''
    if (!meaning) {
      setAdded('failed')
      return
    }
    setAdded(addVocab({
      term: headword,
      word,
      lemma: sense?.lemma || local?.entry?.lemma || headword,
      phonetic: phonetic || undefined,
      partOfSpeech: sense?.partOfSpeech || otherMeanings[0]?.partOfSpeech,
      contextMeaning: meaning,
      explanation: sense?.explanation,
      otherMeanings,
      sentenceEn: sentence,
      sentenceZh: target.sentenceZh,
      slug: target.slug,
      sentenceIdx: target.sentenceIdx,
      startTime: target.startTime,
    }))
  }

  const addLabel = {
    idle: '＋ 加入生词本',
    added: '已加入生词本',
    exists: '这个义项已在生词本',
    failed: '保存失败，请重试',
  }[added]

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="mx-auto max-h-[80%] w-full max-w-lg overflow-y-auto rounded-t-2xl px-4 pt-3 pb-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <SheetTitle className="text-xl font-bold">{headword}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              {phonetic}
              {local?.entry?.note ? <span className="ml-2">{local.entry.note}</span> : null}
            </p>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0 rounded-full" onClick={speak}>
            <Volume2Icon className="size-4" />
            <span>发音</span>
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          {contextState === 'loading' && (
            <div className="rounded-lg bg-primary/8 px-3 py-2">
              <p className="text-xs text-primary">本句义</p>
              <div className="mt-1.5 h-4 w-2/3 animate-pulse rounded bg-primary/15" />
            </div>
          )}

          {contextState === 'ok' && sense && (
            <div className="rounded-lg bg-primary/8 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-primary">本句义</span>
                {sense.partOfSpeech && (
                  <Badge variant="outline" className="h-5 italic text-primary">{sense.partOfSpeech}</Badge>
                )}
              </div>
              <p className="mt-1 text-sm font-medium leading-snug">{sense.contextMeaning}</p>
              {sense.explanation && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{sense.explanation}</p>
              )}
            </div>
          )}

          {contextState === 'degraded' && (
            <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs leading-snug text-muted-foreground">
              上下文判义暂不可用，当前显示常用词典义项
            </p>
          )}

          {localState === 'loading' && <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />}

          {localState === 'done' && otherMeanings.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {contextState === 'ok' ? '其他常见义项' : '常用义项'}
              </p>
              <div className="space-y-1">
                {otherMeanings.map((m, i) => (
                  <div key={`${m.partOfSpeech}-${i}`} className="flex gap-2">
                    {m.partOfSpeech && (
                      <span className="shrink-0 pt-0.5 text-xs italic text-muted-foreground">{m.partOfSpeech}</span>
                    )}
                    <p className="text-sm leading-snug">{m.zh}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localState === 'done' && local?.entry?.en && (
            <p className="text-xs leading-snug text-muted-foreground">{local.entry.en}</p>
          )}

          {localState === 'done' && otherMeanings.length === 0 && contextState !== 'loading' && (
            <p className="text-sm text-muted-foreground">词典里没有收录这个词</p>
          )}
        </div>

        <p className="mt-3 rounded-lg bg-muted/60 p-2 text-xs leading-snug text-muted-foreground">
          {sentence}
        </p>

        <Button
          onClick={onAdd}
          disabled={added === 'added' || added === 'exists'}
          className="mt-4 h-11 w-full rounded-xl text-sm font-semibold"
        >
          {addLabel}
        </Button>
      </SheetContent>
    </Sheet>
  )
}
