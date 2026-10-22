import { beforeEach, afterEach, expect, it, vi } from 'vitest'

beforeEach(() => { sessionStorage.clear(); vi.resetModules() })
afterEach(() => vi.restoreAllMocks())

it('按筛选后的完整顺序浏览，跨越列表分页；标熟和重新排序不改变已开始的队列', async () => {
  const { createWordBrowse, getWordBrowse } = await import('../src/lib/word-browse')
  const terms = Array.from({ length: 80 }, (_, index) => `word-${index}`)
  const round = createWordBrowse(terms, '学习中', '/words?seg=learning')
  terms.splice(59, 1); terms.reverse()
  expect(getWordBrowse(round.id, 'word-59')).toMatchObject({ previous: 'word-58', next: 'word-60', total: 80, index: 59 })
  expect(getWordBrowse(round.id, 'word-0')?.previous).toBeUndefined()
  expect(getWordBrowse(round.id, 'word-79')?.next).toBeUndefined()
  expect(getWordBrowse(round.id, 'not-in-list')).toBeNull()
})

it('刷新后恢复本轮；新一轮不覆盖上一轮的浏览记录', async () => {
  const first = await import('../src/lib/word-browse')
  const a = first.createWordBrowse(['a', 'b'], '搜索', '/words?seg=book')
  const b = first.createWordBrowse(['c', 'd'], '学习中', '/words')
  vi.resetModules()
  const { getWordBrowse } = await import('../src/lib/word-browse')
  expect(getWordBrowse(a.id, 'a')?.next).toBe('b')
  expect(getWordBrowse(b.id, 'd')?.previous).toBe('c')
})

it('存储写入失败时本轮仍可连续浏览；不无限积累历史词表', async () => {
  const { createWordBrowse, getWordBrowse } = await import('../src/lib/word-browse')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const first = createWordBrowse(['a', 'b'], '词表', '/words')
  expect(getWordBrowse(first.id, 'a')?.next).toBe('b')
  const newest = Array.from({ length: 5 }, (_, i) => createWordBrowse([`word${i}`], '词表', '/words')).at(-1)!
  expect(getWordBrowse(first.id, 'a')).toBeNull()
  expect(getWordBrowse(newest.id, 'word4')?.total).toBe(1)
})
