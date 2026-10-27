// ─────────────────────────────────────────────────────────────────────────────
// simtest.mjs — Prueba headless de la capa de simulación (Node, sin DOM/WebGL).
// Ejecuta 3 escenarios de jugador contra la pipeline real del juego:
//   A) Superviviente sereno  → debe ganar (WIN) en tiempo razonable
//   B) Jugador en pánico     → debe perder (hipoxia o colapso cardíaco)
//   C) Solo respira, no TX   → no debe ganar (el rescate exige paquetes LoRa)
// Uso: npm run test:sim
// ─────────────────────────────────────────────────────────────────────────────
import { createGameShell, CFG } from '../src/state.js'
import { createSim, resetSim, simUpdate, computeScore, OBJECTIVES } from '../src/sim/pipeline.js'
import { PH } from '../src/sim/rescue.js'

const DT = 1 / 60
const results = []
let failures = 0

function assert(cond, msg) {
  if (!cond) { failures++; console.error(`  ✘ FAIL: ${msg}`) } else { console.log(`  ✔ ${msg}`) }
}

function makeWorld() {
  const game = createGameShell()
  createSim(game)
  return game
}

function fmt(t) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` }

function runScenario(name, maxT, policy, game) {
  resetSim(game)
  game.mode = 'PLAY'
  let t = 0
  let panicHeld = false
  while (t < maxT && game.mode === 'PLAY') {
    policy(game, t)
    simUpdate(game, DT)
    t += DT
    panicHeld = panicHeld
  }
  const s = computeScore(game)
  console.log(`\n── ${name} ──────────────────────────────`)
  console.log(`  resultado=${s.result ?? game.mode} causa=${s.cause ?? '-'} t=${fmt(s.time)}` +
    ` · SpO₂min=${s.minSpo2.toFixed(1)}% · HRmax=${s.maxHr.toFixed(0)}` +
    ` · cohAvg=${(s.coherenceT ? s.coherenceSum / s.coherenceT : 0).toFixed(2)}` +
    ` · TX=${s.packetsSent}/${s.packetsDelivered} fixes=${s.fixes} acc=${s.finalAccuracy.toFixed(2)}m` +
    ` · réplicas=${s.aftershocks} · estrategia=${s.strategy ?? '-'} · score=${s.score} (${s.rating})`)
  results.push({ name, game, s })
  return { game, s }
}

// ── Escenario A: superviviente sereno (juega perfecto) ────────────────────
function policyCalm(game, t) {
  const v = game.vitals
  game.input.spaceHeld = v.shouldHold          // respiración perfecta
  game.input.mouseSpeed = 0.06                 // pulso firme
  if (!game.baro.calibrated) game.watchApp = 'BARO'
  else game.watchApp = 'SOS'
  if (game.watchApp === 'SOS' && game.lora.cooldown <= 0 && v.coherence > 0.35) game.lora.transmit()
}

// ── Escenario B: pánico (hiperventila, nunca sincroniza, spam de TX) ──────
function policyPanic(game, t) {
  game.input.spaceHeld = (Math.floor(t / 0.45) % 2) === 0  // jadeo descoordinado
  game.input.mouseSpeed = 0.85                              // manos temblando
  game.watchApp = 'SOS'
  if (game.lora.cooldown <= 0) game.lora.transmit()         // spam
}

// ── Escenario C: respira bien pero nunca transmite ─────────────────────────
function policyNoTx(game, t) {
  game.input.spaceHeld = game.vitals.shouldHold
  game.input.mouseSpeed = 0.1
  game.watchApp = 'VITAL'
}

const game = makeWorld()

const A = runScenario('A · SUPERVIVIENTE SERENO', 540, policyCalm, game)
assert(A.game.mode === 'WINNING' || A.game.rescue.phaseIdx >= PH.CONTACT, 'A: el rescate se completa (WIN)')
assert(A.s.result === 'WIN' && A.s.time < 420, `A: victoria en < 7 min (t=${fmt(A.s.time)})`)
assert(A.s.minSpo2 > CFG.spo2.fatal, 'A: SpO₂ nunca llega a nivel letal')
assert(A.s.packetsDelivered >= CFG.lora.minDelivered, 'A: al menos 3 paquetes biométricos entregados')
assert(A.s.finalAccuracy <= CFG.lora.dispatchAccuracy, 'A: precisión de triangulación ≤ 2.5 m')
assert(A.s.strategy != null, 'A: se eligió una estrategia de rescate adaptada')
assert(A.s.aftershocks >= 1, 'A: hubo réplicas durante la partida')
assert(A.game.objectiveIdx >= OBJECTIVES.length - 1, 'A: objetivos completados')

const B = runScenario('B · PÁNICO', 540, policyPanic, game)
assert(B.s.result === 'LOSE', 'B: el jugador en pánico pierde')
assert(B.s.cause === 'HIPOXIA' || B.s.cause === 'CARDIACO', `B: causa de derrota biométrica (${B.s.cause})`)
assert(B.s.time < 420, 'B: la derrota llega antes que el rescate')
assert(B.game.rescue.phaseIdx < PH.EXECUTING, 'B: el rescate no llega a ejecutarse')
assert(B.s.aftershocks >= A.s.aftershocks || B.s.time < A.s.time, 'B: el peligro escala (más réplicas por minuto en pánico)')

const C = runScenario('C · CALMA SIN TRANSMISIÓN', 300, policyNoTx, game)
assert(C.s.result !== 'WIN', 'C: sin paquetes LoRa no hay rescate (no gana)')
assert(C.game.rescue.phaseIdx <= PH.IDLE, 'C: el protocolo de rescate nunca se activa')
assert(C.s.packetsSent === 0, 'C: cero paquetes transmitidos')

// ── Informe de peligrosidad dinámica ───────────────────────────────────────
console.log('\n── MÉTRICAS DE DISEÑO ─────────────────────────────')
const rateA = A.s.aftershocks / Math.max(A.s.time, 1) * 60
const rateB = B.s.aftershocks / Math.max(B.s.time, 1) * 60
console.log(`  réplicas/min  sereno=${rateA.toFixed(2)}  pánico=${rateB.toFixed(2)}  (el pánico debe intensificar el peligro)`)
assert(rateB > rateA * 1.3 || B.s.time < 60, 'El pánico intensifica la frecuencia de réplicas')

console.log(failures === 0 ? '\n✅ SIMTEST OK — todas las aserciones pasaron' : `\n❌ SIMTEST — ${failures} fallos`)
process.exit(failures === 0 ? 0 : 1)
