// ─────────────────────────────────────────────────────────────────────────────
// pipeline.js — Ensambla la capa de simulación pura (sin DOM/three) y cablea
// los eventos entre subsistemas + objetivos + estadísticas. main.js (cliente)
// y scripts/simtest.mjs (Node) comparten exactamente este mismo cableado.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, on, emit, clamp, freshStats } from '../state.js'
import { Vitals } from './vitals.js'
import { Baro } from './baro.js'
import { Lora } from './lora.js'
import { Quake } from './quake.js'
import { Rescue, PH } from './rescue.js'

export const OBJECTIVES = [
  {
    text: 'Sincroniza tu respiración con el anillo guía: mantén ESPACIO al inhalar, suelta al exhalar.',
    hint: 'La coherencia respiratoria estabiliza tu pulso y la señal RF del reloj.',
    done: (g) => g.vitals.coherence >= 0.45
  },
  {
    text: 'Gira el bisel del reloj hasta la app BARÓMETRO y mantén el pulso firme para calibrar.',
    hint: 'Puntero quieto + respiración calmada = lectura barométrica estable.',
    done: (g) => g.baro.calibrated
  },
  {
    text: 'Abre la app SOS y transmite paquetes LoRa (T) hasta fijar tu posición (precisión ≤ 2.5 m).',
    hint: 'Cada paquete porte tu reporte biométrico; con alta calidad, más gateways lo reciben.',
    done: (g) => g.lora.packets.delivered >= CFG.lora.minDelivered && g.lora.accuracy <= CFG.lora.dispatchAccuracy
  },
  {
    text: 'Espera al equipo de rescate holográfico y deja que interprete tus signos vitales.',
    hint: 'Los drones triangularán y elegirán la estrategia según tu estado.',
    done: (g) => g.rescue.phaseIdx >= PH.EXECUTING
  },
  {
    text: 'Mantén la calma y la señal estable hasta completar la extracción.',
    hint: 'El progreso de rescate depende de tu coherencia y de la calidad LoRa.',
    done: (g) => g.rescue.progress >= 100
  }
]

export function createSim(game) {
  game.vitals = new Vitals(game)
  game.baro = new Baro(game)
  game.lora = new Lora(game)
  game.quake = new Quake(game)
  game.rescue = new Rescue(game)

  game.objectiveIdx = 0
  game.stats = freshStats()

  // ── Cableado entre subsistemas ──
  if (!game._simWired) {
    game._simWired = true

    on('aftershock', () => {
      if (game.mode !== 'PLAY') return
      game.vitals.onAftershock()
      game.baro.nudgeDepth(CFG.quake.depthAdd[0] + Math.random() * (CFG.quake.depthAdd[1] - CFG.quake.depthAdd[0]))
      game.lora.glitch(3.2)
      game.rescue.onAftershock()
      if (game.stats) game.stats.aftershocks++
    })

    on('packet-landed', (d) => game.rescue.onPacketLanded(d))

    on('calibrated', () => {
      emit('radio', {
        text: `Barómetro calibrado. Referencia de superficie bloqueada: ${CFG.baro.surfaceRef.toFixed(2)} hPa. Profundidad de sepultamiento fiable.`,
        kind: 'sys', t: game.t
      })
    })

    on('lose', ({ cause }) => {
      if (game.mode !== 'PLAY') return
      game.mode = 'LOSING'
      if (game.stats) { game.stats.result = 'LOSE'; game.stats.cause = cause; game.stats.time = game.t }
      emit('radio', {
        text: cause === 'HIPOXIA'
          ? '⚠ SpO₂ crítico… la señal biométrica se desvanece.'
          : '⚠ Pulso sostenido en zona roja… colapso cardiovascular.',
        kind: 'alert', t: game.t
      })
    })

    on('win', () => {
      if (game.mode !== 'PLAY') return
      game.mode = 'WINNING'
      if (game.stats) { game.stats.result = 'WIN'; game.stats.time = game.t }
    })
  }
}

export function resetSim(game) {
  game.vitals.reset()
  game.baro.reset()
  game.lora.reset()
  game.quake.reset()
  game.rescue.reset()
  game.objectiveIdx = 0
  game.t = 0
  game.stats = freshStats()
  emit('sim-reset', {})
}

// Un tick de la simulación (orden fijo)
export function simUpdate(game, dt) {
  game.t += dt
  game.quake.update(dt)
  game.vitals.update(dt)
  game.baro.update(dt)
  game.lora.update(dt)
  game.rescue.update(dt)
  updateStats(game, dt)
  updateObjectives(game)
}

function updateStats(game, dt) {
  const s = game.stats
  if (!s) return
  const v = game.vitals
  s.time = game.t
  s.minSpo2 = Math.min(s.minSpo2, v.spo2)
  s.maxHr = Math.max(s.maxHr, v.hr)
  s.coherenceSum += v.coherence * dt
  s.coherenceT += dt
  s.coherencePeak = Math.max(s.coherencePeak, v.coherence)
  if (v.coherence >= 0.6) s.coherenceAbove60 += dt
  s.packetsSent = game.lora.packets.sent
  s.packetsDelivered = game.lora.packets.delivered
  s.fixes = game.lora.packets.fixes
  s.finalAccuracy = game.lora.accuracy
  s.strategy = game.rescue.strategyKey
}

function updateObjectives(game) {
  const list = OBJECTIVES
  let idx = game.objectiveIdx
  while (idx < list.length && list[idx].done(game)) idx++
  if (idx !== game.objectiveIdx) {
    const wasIdx = game.objectiveIdx
    game.objectiveIdx = idx
    if (idx < list.length) emit('objective', { idx, prev: wasIdx, text: list[idx].text })
    else emit('objective', { idx: list.length - 1, prev: wasIdx, text: null })
  }
}

// Puntuación final y rango
export function computeScore(game) {
  const s = game.stats
  const cohAvg = s.coherenceT > 0 ? s.coherenceSum / s.coherenceT : 0
  const delivRatio = s.packetsSent > 0 ? s.packetsDelivered / s.packetsSent : 0
  if (s.result === 'WIN') {
    let score = 62
      + cohAvg * 38
      + Math.max(0, s.minSpo2 - 60) * 0.9
      - Math.max(0, s.maxHr - 150) * 0.35
      - Math.max(0, s.time - 150) / 14
      + delivRatio * 18
    s.score = Math.round(clamp(score, 5, 120))
    s.rating = s.score >= 96 ? 'S' : s.score >= 80 ? 'A' : s.score >= 62 ? 'B' : 'C'
  } else {
    let score = cohAvg * 30 + Math.max(0, s.time) / 10 + delivRatio * 10
    s.score = Math.round(clamp(score, 0, 45))
    s.rating = 'C'
  }
  return s
}
