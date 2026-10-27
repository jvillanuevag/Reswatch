// ─────────────────────────────────────────────────────────────────────────────
// lora.js — Enlace de radiofrecuencia LoRa del reloj (banda 915 MHz).
//  · La CALIDAD de señal es función directa de la calma del jugador:
//      q ≈ coherencia·0.5 + (1−ansiedad)·0.3 + calibración·0.2 + jitter
//    → "una respiración calmada estabiliza la señal RF holográfica".
//  · El barómetro define el Spreading Factor (a mayor profundidad, SF mayor:
//    más alcance/penetración, más tiempo en el aire).
//  · Cada paquete porte el reporte biométrico {hr, spo2, depth}. Los gateways
//    que lo reciben permiten triangular; la precisión converge con paquetes
//    de alta calidad.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, clamp, lerp, rnd, emit } from '../state.js'

export class Lora {
  constructor(game) { this.g = game; this.reset() }

  reset() {
    this.q = 0            // calidad suavizada (0..1)
    this.qJit = 0
    this.sf = 10
    this.rssi = -140
    this.snr = -10
    this.cooldown = 0
    this.glitchT = 0      // interferencia tras réplicas
    this.packets = { sent: 0, delivered: 0, failed: 0, fixes: 0 }
    this.accuracy = 45    // m; sin fijación
    this.lastDeliveredT = -99
    this.inFlight = []
    this.gwHits = [0, 0, 0]
    this.lastFixGws = [false, false, false]
  }

  get cooldownMax() { return CFG.lora.cooldownBase + (this.sf - 7) * CFG.lora.cooldownPerSF }
  get cooldownFrac() { return this.cooldownMax > 0 ? clamp(this.cooldown / this.cooldownMax, 0, 1) : 0 }

  update(dt) {
    const v = this.g.vitals
    const b = this.g.baro
    this.glitchT = Math.max(0, this.glitchT - dt)

    let base = v.coherence * 0.50 + (1 - v.anxiety) * 0.30 + (b.calibrated ? 0.20 : 0.03)
    if (this.glitchT > 0) base *= 0.35
    base = clamp(base, 0, 0.98)
    this.qJit = lerp(this.qJit, rnd(-1, 1) * v.anxiety * 0.12, clamp(dt * 3, 0, 1))
    this.q = lerp(this.q, clamp(base + this.qJit, 0, 1), clamp(dt * 2.2, 0, 1))

    let sf = b.suggestedSF
    if (this.q < 0.30) sf = Math.min(12, sf + 1)   // reintentos más robustos
    this.sf = sf

    const d = Math.max(0, b.measuredDepth)
    this.rssi = lerp(this.rssi, -146 + this.q * 34 - d * 0.8 + rnd(-1.4, 1.4), clamp(dt * 4, 0, 1))
    this.snr = lerp(this.snr, -12 + this.q * 22 + rnd(-0.9, 0.9), clamp(dt * 4, 0, 1))

    this.cooldown = Math.max(0, this.cooldown - dt)

    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const p = this.inFlight[i]
      p.t -= dt
      if (p.t <= 0) { this.inFlight.splice(i, 1); this._land(p) }
    }
  }

  transmit() {
    if (this.g.mode !== 'PLAY') return null
    if (this.cooldown > 0) { emit('tx-blocked', { remain: this.cooldown }); return null }

    const v = this.g.vitals, b = this.g.baro
    const pkt = {
      id: this.packets.sent + 1,
      q: this.q, sf: this.sf, rssi: this.rssi, snr: this.snr,
      hr: Math.round(v.hr), spo2: Math.round(v.spo2 * 10) / 10,
      depth: Math.round(b.measuredDepth * 10) / 10,
      t: this.g.t
    }
    this.packets.sent++
    this.cooldown = this.cooldownMax

    // Tiempo en el aire (comprimido para jugabilidad) y entrega estocástica
    const airtime = 0.45 + (this.sf - 7) * 0.30
    const deliverP = clamp(0.12 + this.q * 0.86 - Math.max(0, b.trueDepth - 3) * 0.03, 0.05, 0.97)
    const delivered = Math.random() < deliverP
    const gwP = clamp(0.30 + this.q * 0.62, 0.08, 0.95)
    const gws = [Math.random() < gwP, Math.random() < gwP, Math.random() < gwP]
    if (delivered && !gws.some(Boolean)) gws[rnd(0, 2.999) | 0] = true

    this.inFlight.push({ t: airtime, pkt, delivered, gws })
    emit('packet-tx', { pkt, q: this.q, airtime })
    return pkt
  }

  _land(p) {
    const { pkt, delivered, gws } = p
    if (!delivered) {
      this.packets.failed++
      emit('packet-landed', { delivered: false, pkt, gws, n: 0 })
      return
    }
    this.packets.delivered++
    this.lastDeliveredT = this.g.t
    const n = gws.filter(Boolean).length
    gws.forEach((hit, i) => { if (hit) this.gwHits[i]++ })
    this.lastFixGws = gws

    let fixed = false
    if (n >= 3) {
      this.packets.fixes++
      const factor = clamp(1.08 - pkt.q * 0.68, 0.40, 1.0)
      this.accuracy = Math.max(0.30, this.accuracy * factor)
      fixed = true
    } else {
      this.accuracy = Math.max(0.6, this.accuracy * 0.92)  // refino parcial
    }
    emit('packet-landed', { delivered: true, pkt, gws, n, accuracy: this.accuracy })
    if (fixed) emit('fix', { accuracy: this.accuracy, pkt, gws })
  }

  glitch(t = 3) { this.glitchT = Math.max(this.glitchT, t) }
}
