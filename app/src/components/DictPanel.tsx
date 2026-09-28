import { useEffect, useState } from 'react'
import { addToReview } from '../lib/srs'
import { loadWordbookMap } from '../lib/wordbook'
import { speakWord } from '../lib/clips'
import { normalizeTerm } from '../lib/lookup'
import { Volume2Icon } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { lookupContext, lookupLocal, readCachedSense, senseCacheKeyOf } from '../lib/dict'
import type { DictEntry, LookupRequest, LookupResult } from '../lib/lookup'

export interface DictTarget extends LookupRequest {
  /** 句子结束秒数：记进卡片语境，复习时播这一句 */
  endTime?: number
}

type ContextState = 'idle' | 'loading' | 'ok' | 'degraded'

export default function DictPanel({ target, onClose }: { target: DictTarget; onClose: () => void }) {
  const [local, setLocal] = useState<{ term: string; entry?: DictEntry } | null>(null)
  const [localState, setLocalState] = useState<'loading' | 'done'>('loading')
  const [sense, setSense] = useState<LookupResult | null>(null)
  const [contextState, setContextState] = useState<ContextState>('loading')
  const [added, setAdded] = useState<'idle' | 'added' | 'exists' | 'failed' | 'saving'>('idle')

  const { word, sentence, wordIndex } = target

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    setLocal(null)
    setLocalState('loading')
    setSense(null)
    setAdded('idle')

    void lookupLocal(sentence, wordIndex, result => {
      if (!alive || !result.entry) return
      setLocal({ term: result.term, entry: result.entry })
      setLocalState('done')
    }).then(result => {
      if (!alive) return
      setLocal({ term: result.term, entry: result.entry })
      setLocalState('done')
    }).catch(error => {
      if (!alive) return
      console.error('local dictionary lookup failed', error)
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

  const speak = () => speakWord(headword)

  /** 加入复习：单词按原形建卡（与六级词表合并），词组按词组建卡；这一句记为亲历语境 */
  const onAdd = async () => {
    const meaning = sense?.contextMeaning || otherMeanings[0]?.zh || ''
    if (!meaning) {
      setAdded('failed')
      return
    }
    setAdded('saving')
    try {
      const phrase = headword.includes(' ')
      const term = phrase ? normalizeTerm(headword) : normalizeTerm(sense?.lemma || local?.entry?.lemma || headword)
      const book = await loadWordbookMap().catch(() => new Map())
      const result = await addToReview({
        term,
        kind: phrase ? 'phrase' : 'word',
        inBook: book.has(term),
        meaning,
        phonetic: phonetic || undefined,
        context: target.slug && target.sentenceIdx !== undefined ? {
          slug: target.slug,
          i: target.sentenceIdx,
          en: sentence,
          zh: target.sentenceZh,
          start: target.startTime ?? 0,
          end: target.endTime ?? target.startTime ?? 0,
          w: wordIndex,
          meaning: sense?.contextMeaning || undefined,
        } : undefined,
      })
      setAdded(result === 'added' ? 'added' : 'exists')
    } catch (error) {
      console.error('add to review failed', error)
      setAdded('failed')
    }
  }

  const addLabel = {
    idle: '＋ 加入复习',
    saving: '保存中…',
    added: '已加入复习',
    exists: '已在复习里，这一句记为新例句',
    failed: '保存失败，请重试',
  }[added]

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="app-sheet dict-sheet">
        <div className="app-sheet-body no-scrollbar vertical-scroll">
          <div className="dict-head">
            <div className="min-w-0">
              <SheetTitle className="dict-word">{headword}</SheetTitle>
              <p className="dict-phonetic">
                {phonetic && `/${phonetic.replace(/^\/|\/$/g, '')}/`}
                {local?.entry?.note ? <span>{local.entry.note}</span> : null}
              </p>
            </div>
            <button className="dict-speak" onClick={speak} aria-label="发音">
              <Volume2Icon />
            </button>
          </div>

          {contextState === 'loading' && (
            <div className="dict-sense">
              <p className="dict-label">本句义</p>
              <div className="skeleton dict-sense-skeleton" />
            </div>
          )}

          {contextState === 'ok' && sense && (
            <div className="dict-sense">
              <p className="dict-label">
                本句义
                {sense.partOfSpeech && <i>{sense.partOfSpeech}</i>}
              </p>
              <p className="dict-sense-text">{sense.contextMeaning}</p>
              {sense.explanation && <p className="dict-sense-note">{sense.explanation}</p>}
            </div>
          )}

          {contextState === 'degraded' && (
            <p className="dict-degraded">上下文判义暂不可用，当前显示常用词典义项</p>
          )}

          {localState === 'loading' && <div className="skeleton dict-line-skeleton" />}

          {localState === 'done' && otherMeanings.length > 0 && (
            <div className="dict-meanings">
              <p className="dict-label">{contextState === 'ok' ? '其他常见义项' : '常用义项'}</p>
              {otherMeanings.map((m, i) => (
                <p key={`${m.partOfSpeech}-${i}`} className="dict-meaning">
                  {m.partOfSpeech && <i>{m.partOfSpeech}</i>}
                  <span>{m.zh}</span>
                </p>
              ))}
            </div>
          )}

          {localState === 'done' && local?.entry?.en && (
            <p className="dict-en">{local.entry.en}</p>
          )}

          {localState === 'done' && otherMeanings.length === 0 && contextState !== 'loading' && (
            <p className="dict-degraded">词典里没有收录这个词</p>
          )}

          <p className="dict-sentence" lang="en">{sentence}</p>

          <button
            onClick={() => { void onAdd() }}
            disabled={added === 'added' || added === 'exists' || added === 'saving'}
            className={`pill-button is-large is-wide ${added === 'added' || added === 'exists' ? 'is-soft' : ''}`}
          >
            {addLabel}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
