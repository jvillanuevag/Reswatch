// ─────────────────────────────────────────────────────────────────────────────
// vitals.js — Modelo biométrico simulado del jugador (pulso, SpO₂, ansiedad,
// coherencia HRV por respiración guiada). Sin DOM ni three: 100% headless.
//
// Requisitos de diseño que implementa:
//  · "Si el pulso o la ansiedad se elevan, la visibilidad disminuye y la
//    simulación intensifica el peligro"  → anxiety alimenta quake/visibility.
//  · "Una respiración calmada estabiliza la señal RF" → coherence alimenta lora.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, clamp, lerp, rnd, emit, easeInOut } from '../state.js'

const CYC = CFG.breathCycle

export class Vitals {
  constructor(game) { this.g = game; this.reset() }

  reset() {
    this.hr = CFG.hr.start
    this.spo2 = CFG.spo2.start
    this.spo2Trend = 0
    this.anxiety = CFG.anxiety.start
    this.coherence = 0.08
    this.sync = 0.08
    this.redZone = 0
    this.death = null            // 'HIPOXIA' | 'CARDIACO'

    // guía de respiración
    this.guide = { phase: 0, t: 0, ring: 0.35 }
    this.holdPrev = false
    this.lastBreathStart = -99
    this.respBeats = []
    this.respRate = 24
    this.respAvg = 24

    // ECG sintético
    this.beatPhase = 0
    this.beatCount = 0
  }

  get phaseName() { return CYC[this.guide.phase].name }
  get shouldHold() { return this.guide.phase === 0 || this.guide.phase === 1 }

  update(dt) {
    if (this.death) { this._dying(dt); return }
    const inp = this.g.input || {}
    const held = !!inp.spaceHeld

    this._advanceGuide(dt, held)
    this._updateCoherence(dt, held)
    this._updateRespRate(dt, held)
    this._updateHr(dt)
    this._updateSpo2(dt)
    this._updateAnxiety(dt)

    // Zona roja sostenida → riesgo de colapso
    if (this.hr >= CFG.hr.redZone) this.redZone += dt * (this.hr >= CFG.hr.fatalZone ? 2 : 1)
    else this.redZone = Math.max(0, this.redZone - dt * 0.7)

    // Latido (para audio/ECG)
    this.beatPhase += (this.hr / 60) * dt
    if (this.beatPhase >= 1) { this.beatPhase -= 1; this.beatCount++; emit('heartbeat', { hr: this.hr }) }

    // Muertes
    if (this.spo2 <= CFG.spo2.fatal) this._die('HIPOXIA')
    else if (this.redZone >= CFG.hr.redZoneFatal) this._die('CARDIACO')
  }

  _dying(dt) {
    // Decaimiento dramático durante la cinemática de derrota
    this.hr = lerp(this.hr, this.death === 'CARDIACO' ? 196 : 34, dt * 0.5)
    this.spo2 = Math.max(30, this.spo2 - dt * 0.8)
    this.beatPhase += (this.hr / 60) * dt
    if (this.beatPhase >= 1) { this.beatPhase -= 1; this.beatCount++ }
  }

  _die(cause) {
    if (this.death) return
    this.death = cause
    emit('lose', { cause })
  }

  // ── Guía de respiración ────────────────────────────────────────────────
  _advanceGuide(dt, held) {
    this.guide.t += dt
    let ph = CYC[this.guide.phase]
    while (this.guide.t >= ph.dur) {
      this.guide.t -= ph.dur
      this.guide.phase = (this.guide.phase + 1) % CYC.length
      ph = CYC[this.guide.phase]
      emit('breath-phase', { name: ph.name })
    }
    const p = this.guide.t / ph.dur
    switch (this.guide.phase) {
      case 0: this.guide.ring = 0.35 + 0.65 * easeInOut(p); break   // INHALA
      case 1: this.guide.ring = 1.0; break                          // SOSTÉN
      case 2: this.guide.ring = 1.0 - 0.65 * easeInOut(p); break    // EXHALA
      default: this.guide.ring = 0.35                                // PAUSA
    }
    // Transición de pulsación del jugador (inicio de inhalación real)
    if (held && !this.holdPrev) {
      const now = this.g.t
      if (now - this.lastBreathStart < 45) this.respBeats.push(now)
      else this.respBeats = [now]
      this.lastBreathStart = now
    }
    this.holdPrev = held
  }

  _updateCoherence(dt, held) {
    const match = this.shouldHold === held
    if (match) this.sync += CFG.coherence.riseMatch * dt
    else {
      // Pulsar durante la exhalación = hiperventilación: castigo mayor
      const mult = (held && this.guide.phase === 2) ? 1.25 : 1.0
      this.sync -= CFG.coherence.fallMismatch * mult * dt
    }
    // El dron CALM-LINK garantiza un suelo de coherencia
    const resc = this.g.rescue
    if (resc && resc.strategyKey === 'CALM' && resc.phaseIdx >= 6) this.sync = Math.max(this.sync, 0.14)
    this.sync = clamp(this.sync, 0, 1)
    this.coherence = lerp(this.coherence, this.sync, clamp(dt * 2.4, 0, 1))
  }

  _updateRespRate(dt, held) {
    const now = this.g.t
    this.respBeats = this.respBeats.filter((t) => now - t < 60)
    let measured = null
    if (this.respBeats.length >= 2) {
      const span = (this.respBeats[this.respBeats.length - 1] - this.respBeats[0]) / 60
      if (span > 0.2) measured = clamp((this.respBeats.length - 1) / span, 3, 42)
    }
    // Si el jugador no respira con la guía, el cuerpo jadea según ansiedad
    const est = held ? 14 + this.anxiety * 10 : 17 + this.anxiety * 17
    this.respRate = measured !== null ? measured : est
    this.respAvg = lerp(this.respAvg, this.respRate, clamp(dt * 0.4, 0, 1))
  }

  // ── Frecuencia cardíaca ────────────────────────────────────────────────
  _updateHr(dt) {
    const depth = this.g.baro ? Math.max(0, this.g.baro.measuredDepth) : CFG.baro.startDepth
    const resc = this.g.rescue
    let target = CFG.hr.base
      + this.anxiety * CFG.hr.anxietyGain
      - this.coherence * CFG.hr.coherenceGain
      + Math.max(0, depth - 2) * 1.15
    if (resc && resc.phaseIdx >= 4) target -= 6          // alivio: el rescate está aquí
    if (resc && resc.phaseIdx >= 6) target -= 4          // alivio extra durante extracción
    target = clamp(target, 52, 195)
    this.hr += (target - this.hr) * clamp(dt * CFG.hr.relax, 0, 1)
    this.hr += rnd(-1, 1) * dt * (1.5 + this.anxiety * 5)
    this.hr = clamp(this.hr, 34, 205)
  }

  // ── Saturación de oxígeno ──────────────────────────────────────────────
  _updateSpo2(dt) {
    const depth = this.g.baro ? Math.max(0, this.g.baro.measuredDepth) : CFG.baro.startDepth
    const dust = this.g.quake ? this.g.quake.dust : 0
    const prev = this.spo2
    let decay = CFG.spo2.baseDecay + depth * CFG.spo2.depthDecay + dust * CFG.spo2.dustDecay
    decay *= 1 + Math.max(0, this.hr - 95) * CFG.spo2.panicFactor

    // Respiración coherente = mejor oxigenación (mecánica central)
    if (this.coherence >= 0.5) this.spo2 += (this.coherence - 0.5) * CFG.spo2.breathBonus * dt

    const resc = this.g.rescue
    const medic = resc && resc.strategyKey === 'MEDIC' && resc.phaseIdx >= 6
    const support = resc && resc.supportO2 && resc.phaseIdx >= 6
    if (medic || support) {
      decay *= medic ? 0.30 : 0.55
      this.spo2 += (medic ? CFG.spo2.medicRecover : CFG.spo2.supportRecover) * dt
    }
    this.spo2 = clamp(this.spo2 - decay * dt, 30, 100)
    const inst = (this.spo2 - prev) / Math.max(dt, 1e-4)
    this.spo2Trend = lerp(this.spo2Trend, inst, clamp(dt * 0.8, 0, 1))
  }

  // ── Ansiedad ───────────────────────────────────────────────────────────
  _updateAnxiety(dt) {
    const dust = this.g.quake ? this.g.quake.dust : 0
    const quake = this.g.quake
    const resc = this.g.rescue
    let d = -CFG.anxiety.decayBase
    d -= this.coherence * CFG.anxiety.decayCoherence
    d += Math.max(0, this.hr - 135) * 0.0016
    if (dust > 0.35) d += 0.05 * dust
    if (quake && quake.warnActive) d += 0.035
    if (resc && resc.phaseIdx >= 4) d -= 0.020
    if (this.spo2 < CFG.spo2.warn) d += 0.020
    this.anxiety = clamp(this.anxiety + d * dt, 0, 1)
  }

  // ── Eventos externos ───────────────────────────────────────────────────
  onAftershock() {
    this.anxiety = clamp(this.anxiety + CFG.quake.anxAdd, 0, 1)
    this.hr += CFG.quake.hrAdd
    this.spo2 = clamp(this.spo2 + CFG.quake.spo2Hit, 30, 100)
    this.sync *= 0.5
  }

  // Visibilidad percibida por el visor MR: la ansiedad y el polvo cierran el
  // campo visual; la coherencia lo abre ligeramente.
  get visibility() {
    const dust = this.g.quake ? this.g.quake.dust : 0
    return clamp(1 - this.anxiety * 0.85 - dust * 0.75 + this.coherence * 0.12, 0.04, 1)
  }

  // Muestra del ECG sintético en la fase p∈[0,1) del latido
  ecgAt(p) {
    const g = (c, w, a) => a * Math.exp(-Math.pow((p - c) / w, 2))
    let v = g(0.13, 0.030, 0.13)   // P
    v += g(0.285, 0.010, -0.11)    // Q
    v += g(0.315, 0.011, 1.0)      // R
    v += g(0.345, 0.011, -0.26)    // S
    v += g(0.52, 0.048, 0.30)      // T
    v += rnd(-1, 1) * this.anxiety * 0.025
    return v
  }
}
