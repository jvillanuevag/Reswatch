// ─────────────────────────────────────────────────────────────────────────────
// baro.js — Barómetro MEMS simulado: presión → profundidad de sepultamiento.
//  · profundidad = (P − P0ref) / 0.12 hPa/m   (escala barométrica real)
//  · El ruido de lectura crece con la ansiedad y con el TEMBLOR DE MUÑECA
//    (velocidad del puntero del jugador): manipular el reloj con pulso firme
//    es parte de la jugabilidad.
//  · Calibración: mantener la app BARO abierta con lectura estable elimina el
//    error de referencia y reduce el suavizado.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, clamp, lerp, rnd, emit } from '../state.js'

export class Baro {
  constructor(game) { this.g = game; this.reset() }

  reset() {
    this.surfaceRef = CFG.baro.surfaceRef
    this.trueDepth = CFG.baro.startDepth
    // Error de referencia sin calibrar (±0.9–2 m aparentes)
    this.offsetError = rnd(0.11, 0.24) * (Math.random() < 0.5 ? -1 : 1)
    this.raw = this.surfaceRef + this.trueDepth * CFG.baro.hPaPerM
    this.smooth = this.raw
    this.measuredDepth = this.trueDepth - this.offsetError / CFG.baro.hPaPerM
    this.calibrated = false
    this.calibProgress = 0
    this.stability = 0
    this.tremor = 0
  }

  update(dt) {
    const inp = this.g.input || {}
    const v = this.g.vitals
    const tremorIn = clamp(inp.mouseSpeed || 0, 0, 1)
    this.tremor = lerp(this.tremor, tremorIn, clamp(dt * 3.5, 0, 1))

    const noiseAmp = CFG.baro.noiseBase + v.anxiety * CFG.baro.noiseAnx + this.tremor * CFG.baro.noiseTremor
    this.raw = this.surfaceRef
      + this.trueDepth * CFG.baro.hPaPerM
      + rnd(-1, 1) * noiseAmp
      + Math.sin(this.g.t * 2.1) * 0.018            // marea barométrica lenta
    const smoothK = this.calibrated ? 3.4 : 1.7
    this.smooth = lerp(this.smooth, this.raw, clamp(dt * smoothK, 0, 1))

    const p0ref = this.surfaceRef + (this.calibrated ? 0 : this.offsetError)
    this.measuredDepth = (this.smooth - p0ref) / CFG.baro.hPaPerM

    // ── Calibración (requiere app BARO abierta + lectura estable) ──
    this.stability = clamp(1 - this.tremor * 1.7 - v.anxiety * 0.55 - noiseAmp * 0.8, 0, 1)
    if (!this.calibrated) {
      if (this.g.watchApp === 'BARO' && this.stability > CFG.baro.calibThreshold) {
        this.calibProgress += dt * (this.stability - CFG.baro.calibThreshold) * 0.62
      } else {
        this.calibProgress = Math.max(0, this.calibProgress - dt * 0.10)
      }
      if (this.calibProgress >= 1) {
        this.calibProgress = 1
        this.calibrated = true
        emit('calibrated', {})
      }
    }
  }

  // Asentamiento de escombros tras una réplica
  nudgeDepth(d) {
    this.trueDepth = clamp(this.trueDepth + d, CFG.baro.minDepth, CFG.baro.maxDepth)
  }

  // Spreading Factor LoRa sugerido por la profundidad de sepultamiento
  get suggestedSF() {
    const d = this.measuredDepth
    if (d >= 5.5) return 12
    if (d >= 4.0) return 11
    if (d >= 2.5) return 10
    if (d >= 1.0) return 9
    return 8
  }
}
