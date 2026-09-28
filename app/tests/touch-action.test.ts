import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom 环境下 import.meta.url 不是 file: 协议，只能从 vitest 的工作目录（app/）推路径
const SRC = resolve(process.cwd(), 'src')
const css = readFileSync(resolve(SRC, 'index.css'), 'utf-8')

function classesOf(file: string): string {
  return readFileSync(resolve(SRC, file), 'utf-8')
}

describe('触摸方向', () => {
  it('body 不能声明成只允许纵向：touch-action 沿祖先链取交集，会锁死横向列表', () => {
    const body = css.slice(css.indexOf('\nbody {'), css.indexOf('.safe-bottom'))
    expect(body).toContain('touch-action: pan-x pan-y')
    expect(body).not.toMatch(/touch-action:\s*pan-y\s*;/)
  })

  it('纵向和横向容器各自声明方向', () => {
    expect(css).toMatch(/\.vertical-scroll\s*\{[^}]*touch-action:\s*pan-y/)
    expect(css).toMatch(/\.horizontal-scroll\s*\{[^}]*touch-action:\s*pan-x/)
  })

  it('边界不橡皮筋', () => {
    expect(css).toMatch(/\.vertical-scroll\s*\{[^}]*overscroll-behavior-y:\s*none/)
    expect(css).toMatch(/\.horizontal-scroll\s*\{[^}]*overscroll-behavior-x:\s*none/)
  })
})

describe('滚动容器都带方向类', () => {
  it('任何横向滚动容器都同时声明 horizontal-scroll', () => {
    for (const file of readdirSync(resolve(SRC, 'pages')).map(f => `pages/${f}`)
      .concat(readdirSync(resolve(SRC, 'components')).filter(f => f.endsWith('.tsx')).map(f => `components/${f}`))) {
      for (const m of classesOf(file).matchAll(/className="([^"]*overflow-x-auto[^"]*)"/g)) {
        expect(m[1], file).toContain('horizontal-scroll')
      }
    }
  })

  it('纵向页面、字幕区、背词卡与单词详情用 vertical-scroll', () => {
    expect(classesOf('App.tsx')).toMatch(/overflow-y-auto[^"]*vertical-scroll/)
    expect(classesOf('pages/Player.tsx')).toMatch(/overflow-y-auto[^"]*vertical-scroll/)
    expect(classesOf('pages/Review.tsx')).toMatch(/overflow-y-auto[^"]*vertical-scroll/)
    expect(classesOf('pages/WordDetail.tsx')).toMatch(/overflow-y-auto[^"]*vertical-scroll/)
  })
})
