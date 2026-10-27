// ─────────────────────────────────────────────────────────────────────────────
// quake.js — Planificador de réplicas sísmicas. Implementa la regla central:
// "si el pulso o la ansiedad se elevan, la simulación INTENSIFICA EL PELIGRO".
// El intervalo entre réplicas se multiplica por panicMul (0.42) cuando el
// jugador está en pánico: el miedo atrae el colapso.
// También mantiene `dust` (polvo en suspensión) y `shake` (sacudida), que
// consumen el entorno 3D y el modelo de visibilidad/SpO₂.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, clamp, rnd, emit } from '../state.js'

const Q = CFG.quake

export class Quake {
  constructor(game) { this.g = game; this.reset() }

  reset() {
    this.state = 'IDLE'      // IDLE → WARN → ACTIVE → IDLE
    this.timer = this._nextInterval()
    this.warnActive = false
    this.shake = 0           // 0..1 para la cámara
    this.dust = 0.10         // polvo en suspensión 0..1
    this.microT = 0          // microtemblores ambientales
    this.count = 0
    this.enabled = true
  }

  _nextInterval() {
    return Q.intervalBase + rnd(-Q.intervalVar, Q.intervalVar)
  }

  get panicking() {
    const v = this.g.vitals
    return v && (v.hr > Q.panicHr || v.anxiety > Q.panicAnx)
  }

  update(dt) {
    if (!this.enabled) { this.shake = Math.max(0, this.shake - dt); this.dust = Math.max(0.06, this.dust - dt * 0.08); return }
    const v = this.g.vitals

    this.timer -= dt * (this.panicking ? 1 / Q.panicMul : 1)

    switch (this.state) {
      case 'IDLE':
        this.warnActive = false
        this.shake = Math.max(0, this.shake - dt * 0.8)
        // Microtemblor ambiental proporcional a la tensión
        this.microT = 0.05 + (v ? v.anxiety : 0) * 0.12
        if (this.timer <= Q.warnTime) {
          this.state = 'WARN'
          this.warnActive = true
          emit('aftershock-warn', {})
        }
        break
      case 'WARN':
        this.warnActive = true
        this.shake = Math.max(this.shake, 0.18 + 0.1 * Math.sin(this.g.t * 30))
        if (this.timer <= 0) {
          this.state = 'ACTIVE'
          this.eventT = 0
          this.count++
          emit('aftershock', { n: this.count })
        }
        break
      case 'ACTIVE':
        this.warnActive = false
        this.eventT += dt
        const k = 1 - this.eventT / Q.duration
        this.shake = Math.max(0, k) * (0.75 + 0.25 * Math.sin(this.eventT * 47))
        if (this.eventT > Q.duration) {
          this.state = 'IDLE'
          this.timer = this._nextInterval()
          emit('aftershock-end', {})
        }
        break
    }

    // Polvo: sube con la réplica activa, decanta lentamente
    if (this.state === 'ACTIVE') this.dust = clamp(this.dust + dt * 0.85, 0, 1)
    else this.dust = clamp(this.dust - dt * (0.10 + (v ? v.coherence : 0) * 0.04), 0.05, 1)
  }

  // Ráfaga puntual de polvo (caída de escombros menor)
  dustBurst(amount = 0.25) { this.dust = clamp(this.dust + amount, 0, 1) }
}
