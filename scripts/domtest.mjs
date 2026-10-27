// ─────────────────────────────────────────────────────────────────────────────
// domtest.mjs — Smoke test de la capa de presentación sin navegador.
// jsdom + tres (sin WebGLRenderer) ejecutan los módulos REALES de UI/escena:
// Hud, Watch, Holograms y Environment, más 6 s de simulación con eventos.
// Detecta referencias a elementos inexistentes, APIs mal usadas, etc.
// Uso: npm run test:dom
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import * as THREE from 'three'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' })
const { window } = dom

// Contexto 2D falso: suficiente para que el dibujo procedural no falle
function make2D(canvas) {
  const gradient = { addColorStop() {} }
  const target = { canvas }
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop]
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 9 })
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient' || prop === 'createPattern') return () => gradient
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
      if (prop === 'putImageData' || prop === 'drawImage') return () => {}
      return () => {}
    },
    set(t, prop, v) { t[prop] = v; return true }
  })
}
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind !== '2d') return null
  this.__ctx ||= make2D(this)
  return this.__ctx
}
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'

globalThis.window = window
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLCanvasElement = window.HTMLCanvasElement

const { createGameShell, CFG, emit, LAYERS } = await import('../src/state.js')
const { createSim, resetSim, simUpdate, computeScore } = await import('../src/sim/pipeline.js')
const { Environment } = await import('../src/mr/environment.js')
const { Watch } = await import('../src/mr/watch.js')
const { Holograms } = await import('../src/mr/holograms.js')
const { Hud } = await import('../src/ui/hud.js')

let failures = 0
const assert = (cond, msg) => {
  if (cond) console.log(`  ✔ ${msg}`)
  else { failures++; console.error(`  ✘ FAIL: ${msg}`) }
}

const game = createGameShell()
createSim(game)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.02, 300)
scene.add(camera)

const actions = {
  start() {}, restart() {}, cycleLayer() {}, toggleMute() {}, togglePause() {}
}

console.log('\n── CONSTRUCCIÓN DE LA CAPA DE PRESENTACIÓN ─────────')
let env, watch, holo, hud
try {
  env = new Environment(scene, camera, game)
  game.env = env
  assert(true, 'Environment construido (escombros, polvo, capas MR)')
  watch = new Watch(camera, game)
  game.watch = watch
  assert(true, 'Watch construido y enlazado a la cámara')
  holo = new Holograms(scene, camera, game)
  game.holo = holo
  assert(true, 'Holograms construido (gateways, drones, túnel)')
  hud = new Hud(game, actions)
  game.hud = hud
  assert(true, 'Hud construido sobre el DOM real de index.html')
} catch (e) {
  console.error(e)
  failures++
  console.error('  ✘ FAIL: la construcción lanzó una excepción')
  process.exit(1)
}

// Comprobación de que todos los IDs usados por el HUD existen en el HTML
const ids = ['hud','menu-screen','end-screen','objective','hint','timer','hr-val','spo2-val','spo2-fill',
  'coh-val','coherence-fill','anx-fill','resp-val','baro-hpa','baro-depth','calib-fill','calib-state',
  'sig-fill','lora-sf','lora-snr','pkt-info','acc-val','tx-cooldown','tx-label','rescue-phase',
  'tri-state','rescue-prog-fill','rescue-prog-val','rescue-strategy','log','toast','breath-ring',
  'breath-core','breath-phase','vignette','redpulse','hypoxia','whiteness','pause-overlay','pause-btn',
  'layer-btn','mute-btn','vitals-panel','env-panel','rescue-panel','end-title','end-sub','end-stats',
  'end-rating','end-rating-label','start-btn','restart-btn','breath-wrap','ecg']
const missing = ids.filter((id) => !window.document.getElementById(id))
assert(missing.length === 0, `todos los IDs del HUD existen${missing.length ? ' (faltan: ' + missing.join(', ') + ')' : ''}`)

// ── Partida simulada con presentación activa ───────────────────────────────
function stepFrame(t, dt) {
  const v = game.vitals
  game.input.spaceHeld = v.shouldHold
  game.input.mouseSpeed = 0.05
  if (!game.baro.calibrated) game.watchApp = 'BARO'
  else { game.watchApp = 'SOS'; if (game.lora.cooldown <= 0) game.lora.transmit() }
  simUpdate(game, dt)
  env.update(dt, game)
  watch.update(dt, game)
  holo.update(dt, game)
  hud.update(dt, game)
}

console.log('\n── EJECUCIÓN DE 210 s DE SIMULACIÓN CON PRESENTACIÓN ──')
try {
  resetSim(game)
  game.mode = 'PLAY'
  hud.beginPlay()
  emit('radio', { text: 'Mensaje de prueba', kind: 'sys', t: 0 })

  let t = 0
  const dt = 1 / 30
  while (t < 210 && game.mode === 'PLAY') {
    stepFrame(t, dt)
    t += dt
    // Ejercitar cambios de capa y apps del reloj
    if (Math.floor(t) % 37 === 0 && Math.floor(t) !== game._lastLayerSwitch) {
      game._lastLayerSwitch = Math.floor(t)
      game.layer = (game.layer + 1) % LAYERS.length
      env.setLayer(game.layer)
      watch.nextApp(1)
      watch.trigger()
    }
  }
  assert(true, `210 s de frames sin excepciones (estado=${game.mode}, t=${game.t.toFixed(0)}s)`)

  // El HUD refleja la telemetría
  const hrText = window.document.getElementById('hr-val').textContent
  assert(hrText !== '--' && Number(hrText) > 30, `HUD muestra el pulso (${hrText} bpm)`)
  const depthText = window.document.getElementById('baro-depth').textContent
  assert(/m$/.test(depthText), `HUD muestra profundidad (${depthText})`)
  const phaseText = window.document.getElementById('rescue-phase').textContent
  assert(phaseText !== 'EN ESPERA' || game.rescue.phaseIdx > 0, `HUD muestra la fase de rescate (${phaseText})`)
  const logItems = window.document.querySelectorAll('#log .log-item')
  assert(logItems.length > 0, `el registro de radio recibió mensajes (${logItems.length})`)
  const breathText = window.document.getElementById('breath-phase').textContent
  assert(breathText.length > 0, `la guía de respiración se actualiza ("${breathText}")`)
  const score = computeScore(game)
  assert(Number.isFinite(score.score), `puntuación calculada (${score.score} / rango ${score.rating})`)

  // Pantalla final
  hud.showEnd(game)
  assert(!window.document.getElementById('end-screen').classList.contains('hidden'), 'se muestra el informe final')
  assert(window.document.querySelectorAll('#end-stats .stat-cell').length >= 6, 'el informe final tiene estadísticas')
} catch (e) {
  console.error(e)
  failures++
  console.error('  ✘ FAIL: excepción durante los frames')
}

console.log(failures === 0 ? '\n✅ DOMTEST OK — la capa de presentación se ejecuta sin errores' : `\n❌ DOMTEST — ${failures} fallos`)
process.exit(failures === 0 ? 0 : 1)
