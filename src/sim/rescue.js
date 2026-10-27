// ─────────────────────────────────────────────────────────────────────────────
// rescue.js — IA del protocolo de rescate.
// Recibe los paquetes LoRa con el reporte biométrico, espera la fijación de
// posición (triangulación), despliega drones holográficos y ELIGE ESTRATEGIA
// según los signos vitales del jugador:
//   · SpO₂ baja            → MEDIC-O₂   (dron médico, oxígeno dirigido)
//   · Ansiedad/pulso altos → CALM-LINK  (dron de acompañamiento respiratorio)
//   · Gran profundidad     → HEAVY-DRILL(equipo de perforación)
//   · Estable y somero     → RAPID-EXTRACT
// El progreso de extracción depende de la calidad de señal y de la estabilidad
// del jugador: hay que seguir respirando y transmitiendo hasta el final.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, clamp, emit, rnd } from '../state.js'

export const PH = {
  IDLE: 0, ALERTED: 1, TRIANG: 2, DISPATCHED: 3, ONSITE: 4,
  ANALYZING: 5, EXECUTING: 6, CONTACT: 7, DONE: 8
}
export const PHASE_LABEL = {
  0: 'EN ESPERA', 1: 'ALERTA RECIBIDA', 2: 'TRIANGULANDO', 3: 'UNIDAD DESPACHADA',
  4: 'DRON EN SITIO', 5: 'ANÁLISIS BIOMÉTRICO', 6: 'EXTRACCIÓN EN CURSO',
  7: '¡CONTACTO!', 8: 'COMPLETADO'
}

const R = CFG.rescue

export class Rescue {
  constructor(game) { this.g = game; this.reset() }

  reset() {
    this.phaseIdx = PH.IDLE
    this.phaseT = 0
    this.progress = 0
    this.strategyKey = null
    this.supportO2 = false
    this.milestones = [false, false, false]
    this.lastRemind = -99
    this.contactT = 0
  }

  get phase() { return PHASE_LABEL[this.phaseIdx] || '—' }

  _setPhase(p, msg, kind = 'rescue') {
    if (this.phaseIdx >= p) return
    this.phaseIdx = p
    this.phaseT = 0
    if (msg) this._radio(msg, kind)
    emit('rescue-phase', { phase: p, label: PHASE_LABEL[p] })
  }

  _radio(text, kind = 'rescue') { emit('radio', { text, kind, t: this.g.t }) }

  // ── Entrada: paquetes aterrizados ─────────────────────────────────────
  onPacketLanded({ delivered, pkt, gws, n }) {
    if (this.phaseIdx >= PH.DISPATCHED) return
    if (!delivered) {
      this._radio(`Paquete #${pkt.id} perdido… SNR insuficiente. Estabiliza la señal respirando.`, 'alert')
      return
    }
    const gwList = gws.map((h, i) => (h ? `GW-0${i + 1}` : null)).filter(Boolean).join(', ')
    if (this.phaseIdx === PH.IDLE) {
      this._setPhase(PH.ALERTED,
        `Paquete biométrico #${pkt.id} recibido (${gwList}). HR ${pkt.hr} bpm · SpO₂ ${pkt.spo2}% · profundidad ~${pkt.depth} m.`, 'gw')
      this._radio('Centro de control: hay un superviviente transmitiendo. Inicien protocolo.', 'gw')
    } else if (this.phaseIdx === PH.ALERTED && this.g.lora.packets.delivered >= 2) {
      this._setPhase(PH.TRIANG, `Múltiples fijaciones. Triangulando posición con tiempos de llegada LoRa…`, 'gw')
    }
    if (n >= 3 && this.g.lora.packets.delivered >= CFG.lora.minDelivered
        && this.g.lora.accuracy <= CFG.lora.dispatchAccuracy && this.phaseIdx < PH.DISPATCHED) {
      this._setPhase(PH.DISPATCHED,
        `Posición fijada: ±${this.g.lora.accuracy.toFixed(1)} m. Despachando unidad de rescate holográfica.`, 'rescue')
    }
  }

  // ── Tick ───────────────────────────────────────────────────────────────
  update(dt) {
    this.phaseT += dt
    switch (this.phaseIdx) {
      case PH.DISPATCHED:
        if (this.phaseT >= R.flightTime) {
          this._setPhase(PH.ONSITE, 'Dron explorador en posición. Escaneando cavidad bajo los escombros…')
        }
        break
      case PH.ONSITE:
        if (this.phaseT >= R.scanTime) {
          this._setPhase(PH.ANALYZING, 'Escaneo completo. Interpretando reporte biométrico en tiempo real…')
        }
        break
      case PH.ANALYZING:
        if (this.phaseT >= R.analyzeTime) this._chooseStrategy()
        break
      case PH.EXECUTING: {
        const rate = this._progressRate()
        this.progress = clamp(this.progress + rate * dt, 0, 100)
        const marks = [25, 50, 75]
        marks.forEach((m, i) => {
          if (!this.milestones[i] && this.progress >= m) {
            this.milestones[i] = true
            this._radio(this._milestoneMsg(m))
          }
        })
        // Aviso si la señal carried
        if (this.g.t - this.g.lora.lastDeliveredT > R.remindInterval && this.g.t - this.lastRemind > R.remindInterval) {
          this.lastRemind = this.g.t
          this._radio('Señal degradada: el equipo pierde tu telemetría. Respira y retransmite (T).', 'alert')
        }
        if (this.progress >= 100) {
          this._setPhase(PH.CONTACT, '¡Apertura completada! Contacto visual con el superviviente. Iniciando extracción…')
          emit('contact', {})
        }
        break
      }
      case PH.CONTACT:
        this.contactT += dt
        if (this.contactT >= R.contactTime) {
          this._setPhase(PH.DONE, 'Extracción completada. Signos vitales estables. Bienvenido de vuelta.')
          emit('win', {})
        }
        break
    }
  }

  _milestoneMsg(m) {
    const msgs = {
      25: 'Ruta de acceso marcada: 25% del retiro de escombros completado.',
      50: 'Mitad del canal abierto. El dron reporta cavidad estable. Sigue respirando así.',
      75: '75%… ya se filtra luz por la grieta. Aguanta, casi estás fuera.'
    }
    return msgs[m]
  }

  _progressRate() {
    const s = R.strategies[this.strategyKey] || R.strategies.RAPID
    const v = this.g.vitals
    const q = this.g.lora.q
    const qFactor = (1 - s.qWeight) + s.qWeight * q
    let vitalsFactor = clamp(0.55 + v.coherence * 0.45 - Math.max(0, v.hr - 128) / 190, 0.30, 1.10)
    if (this.strategyKey === 'RAPID' && v.hr > 140) vitalsFactor *= 0.6
    if (this.strategyKey === 'CALM') vitalsFactor = clamp(vitalsFactor + 0.12, 0.3, 1.15)
    return s.base * qFactor * vitalsFactor
  }

  _chooseStrategy() {
    const v = this.g.vitals
    const b = this.g.baro
    let key
    const hypoxic = v.spo2 < 86 || (v.spo2 < 90 && v.spo2Trend < -0.08 && v.hr > 120)
    if (hypoxic) key = 'MEDIC'
    else if (v.anxiety > 0.55 || v.hr > 125) key = 'CALM'
    else if (b.measuredDepth >= 4.2) key = 'HEAVY'
    else key = 'RAPID'

    this.strategyKey = key
    this.supportO2 = key !== 'MEDIC' && v.spo2 < 93
    const s = R.strategies[key]
    this._radio(`Lectura biométrica: HR ${Math.round(v.hr)} bpm · SpO₂ ${v.spo2.toFixed(0)}% · ` +
      `ansiedad ${(v.anxiety * 100).toFixed(0)}% · profundidad ${b.measuredDepth.toFixed(1)} m.`)
    this._radio(`Estrategia adaptada a tus signos vitales → ${s.name}. ${s.desc}`)
    if (this.supportO2) this._radio('Apoyo adicional: cápsula de O₂ de respaldo desplegada.')
    emit('strategy', { key, strategy: s, supportO2: this.supportO2 })
    this.phaseIdx = PH.EXECUTING
    this.phaseT = 0
    emit('rescue-phase', { phase: PH.EXECUTING, label: PHASE_LABEL[PH.EXECUTING] })
  }

  // ── Impactos externos ──────────────────────────────────────────────────
  onAftershock() {
    if (this.phaseIdx === PH.EXECUTING || this.phaseIdx === PH.CONTACT) {
      const hit = R.strategies[this.strategyKey] ? CFG.quake.progressHitBase + this.g.vitals.anxiety * 6 : 4
      this.progress = clamp(this.progress - hit, 0, 100)
      this._radio('¡Desprendimiento! La ruta se bloquea parcialmente… reevaluando.', 'alert')
    } else if (this.phaseIdx >= PH.DISPATCHED) {
      this._radio('Réplica detectada: el dron mantiene posición estable.', 'alert')
    }
  }

  // Datos para el HUD/hologramas
  get strategyDef() { return this.strategyKey ? R.strategies[this.strategyKey] : null }
}
