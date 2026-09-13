/**
 * 3D 文字标签：自绘 CanvasTexture，不用 drei 的 <Text>。
 *
 * 选型理由（AGENTS.md 二·2「不引入需要服务端/外网的方案」）：
 * drei <Text> 底层是 troika-three-text，默认字体要从 CDN 拉 woff，
 * 在 GitHub Pages + 弱网/内网环境下会让整个 3D 场景卡在字体加载上；
 * 自绘 canvas 零外部请求、零额外依赖，且同文案贴图可跨帧复用。
 *
 * 贴图尺寸按 2 的幂对齐并缓存，避免每帧重建 GPU 纹理（性能红线：单演示 < 200 mesh）。
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

export interface LabelStyle {
  color: string
  /** CSS 字号（画布像素），越大越清晰，贴图也越大 */
  size?: number
  bold?: boolean
  /** 半透明底板，浅色场景下保证对比度 */
  background?: string | null
}

const cache = new Map<string, CanvasTexture>()

function nextPow2(v: number): number {
  let p = 1
  while (p < v) p *= 2
  return p
}

export function labelTexture(text: string, style: LabelStyle): CanvasTexture {
  const size = style.size ?? 44
  const bold = style.bold ? '700' : '500'
  const bg = style.background ?? null
  const key = `${text}|${style.color}|${size}|${bold}|${bg ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit

  const font = `${bold} ${size}px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`
  const measure = document.createElement('canvas').getContext('2d')
  let textWidth = size * 2
  if (measure) {
    measure.font = font
    textWidth = Math.ceil(measure.measureText(text).width) + size
  }
  const w = nextPow2(Math.max(64, textWidth))
  const h = nextPow2(Math.max(64, Math.ceil(size * 1.8)))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, w, h)
    if (bg) {
      ctx.fillStyle = bg
      const pad = Math.round(size * 0.22)
      const tw = Math.ceil(ctx.measureText(text).width) || textWidth - size
      ctx.beginPath()
      ctx.roundRect(w / 2 - tw / 2 - pad, h / 2 - size * 0.78, tw + pad * 2, size * 1.56, size * 0.28)
      ctx.fill()
    }
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style.color
    ctx.fillText(text, w / 2, h / 2)
  }

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  cache.set(key, tex)
  return tex
}

/** 贴图宽高比：sprite 按此比例给 scale，避免文字被拉扁 */
export function labelAspect(text: string, style: LabelStyle): number {
  const size = style.size ?? 44
  const bold = style.bold ? '700' : '500'
  const bg = style.background ?? null
  const key = `${text}|${style.color}|${size}|${bold}|${bg ?? ''}`
  const tex = cache.get(key)
  if (tex?.image) return tex.image.width / tex.image.height
  return 2
}

/**
 * 卸载时清空缓存。three 的 CanvasTexture 由 GPU 侧持有，
 * 路由切走后若不清，反复进出 3D 馆会把显存吃满。
 */
export function disposeLabelCache(): void {
  for (const tex of cache.values()) tex.dispose()
  cache.clear()
}

export const labelCacheSize = (): number => cache.size
