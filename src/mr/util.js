// ─────────────────────────────────────────────────────────────────────────────
// util.js — Utilidades procedurales compartidas por la capa 3D / MR.
// Ninguna textura se carga de red: todo se genera en canvas (offline-friendly).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'

const texCache = new Map()

export function canvasTexture(key, w, h, draw, opts = {}) {
  if (texCache.has(key)) return texCache.get(key)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  if (opts.repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(opts.repeat[0], opts.repeat[1]) }
  if (opts.nearest) tex.magFilter = THREE.NearestFilter
  tex.anisotropy = 4
  texCache.set(key, tex)
  return tex
}

export function glowTexture() {
  return canvasTexture('glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.65)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

// Etiqueta holográfica flotante (sprite de canvas)
export function labelSprite(text, { color = '#8ff6ff', bg = 'rgba(6,20,28,0.72)', scale = 1, font = '700 30px ui-monospace, monospace', pad = 18, border = true } = {}) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width + pad * 2)
  const h = 56
  c.width = w; c.height = h
  const x = c.getContext('2d')
  x.fillStyle = bg
  x.fillRect(0, 0, w, h)
  if (border) {
    x.strokeStyle = color
    x.lineWidth = 2
    x.globalAlpha = 0.85
    x.strokeRect(1, 1, w - 2, h - 2)
    x.globalAlpha = 0.35
    x.fillStyle = color
    x.fillRect(0, 0, 4, h)
  }
  x.globalAlpha = 1
  x.font = font
  x.fillStyle = color
  x.textBaseline = 'middle'
  x.fillText(text, pad, h / 2 + 1)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.95 })
  const sprite = new THREE.Sprite(mat)
  const s = 0.056 * scale
  sprite.scale.set(w * s, h * s, 1)
  sprite.userData.baseScale = sprite.scale.clone()
  return sprite
}

export function concreteTexture(key = 'concrete', repeat = [3, 3]) {
  return canvasTexture(key, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3b4048'
    ctx.fillRect(0, 0, w, h)
    // moteado
    for (let i = 0; i < 5200; i++) {
      const x = Math.random() * w, y = Math.random() * h
      const a = Math.random() * 0.14
      const v = Math.random() < 0.5 ? 0 : 255
      ctx.fillStyle = `rgba(${v},${v},${v},${a})`
      const r = Math.random() * 2.4 + 0.3
      ctx.fillRect(x, y, r, r)
    }
    // grietas
    for (let i = 0; i < 26; i++) {
      ctx.beginPath()
      ctx.strokeStyle = `rgba(10,12,16,${0.35 + Math.random() * 0.4})`
      ctx.lineWidth = Math.random() * 1.8 + 0.4
      let x = Math.random() * w, y = Math.random() * h
      ctx.moveTo(x, y)
      const segs = 6 + (Math.random() * 10 | 0)
      for (let s = 0; s < segs; s++) {
        x += (Math.random() - 0.5) * 70
        y += (Math.random() - 0.5) * 70
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    // manchas de humedad
    for (let i = 0; i < 14; i++) {
      const g = ctx.createRadialGradient(Math.random() * w, Math.random() * h, 2, Math.random() * w, Math.random() * h, 40 + Math.random() * 90)
      g.addColorStop(0, 'rgba(20,24,28,0.35)')
      g.addColorStop(1, 'rgba(20,24,28,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  }, { repeat })
}

export function dustTexture() {
  return canvasTexture('dust', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.45, 'rgba(210,225,235,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

export function disposeObject(obj) {
  obj.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m) => { if (m.map && m.map.__keep !== true) m.map.dispose?.(); m.dispose?.() })
    }
  })
}
