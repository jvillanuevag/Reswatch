// ─────────────────────────────────────────────────────────────────────────────
// main.js — Bootstrap del simulador: WebGL, bucle, cámara del visor MR,
// interacción (reloj + respiración), flujo de pantallas y cableado de audio.
// ─────────────────────────────────────────────────────────────────────────────
import './style.css'
import * as THREE from 'three'
import { createGameShell, clamp, lerp, rnd, LAYERS, emit, on } from './state.js'
import { createSim, resetSim, simUpdate, computeScore } from './sim/pipeline.js'
import { Environment } from './mr/environment.js'
import { Watch } from './mr/watch.js'
import { Holograms } from './mr/holograms.js'
import { Hud } from './ui/hud.js'
import { AudioEngine } from './audio.js'

const game = createGameShell()
createSim(game)

// ── Renderer ───────────────────────────────────────────────────────────────
let renderer
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
} catch (e) {
  document.getElementById('boot-fallback').textContent = 'Tu navegador no soporta WebGL2 — RESWATCH requiere él.'
  throw e
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.06
const appEl = document.getElementById('app')
appEl.insertBefore(renderer.domElement, appEl.firstChild)
document.getElementById('boot-fallback')?.remove()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.02, 300)
camera.rotation.order = 'YXZ'
camera.position.set(0, 1.3, 0.25)
scene.add(camera)

// ── Subsistemas de presentación ────────────────────────────────────────────
game.audio = new AudioEngine(game)
const env = new Environment(scene, camera, game)
const watch = new Watch(camera, game)
const holo = new Holograms(scene, camera, game)
game.env = env
game.watch = watch
game.holo = holo

// ── Acciones de UI ─────────────────────────────────────────────────────────
function actions() {}
actions.start = startGame
actions.restart = startGame
actions.cycleLayer = () => {
  game.layer = (game.layer + 1) % LAYERS.length
  env.setLayer(game.layer)
  hud.toast(LAYERS[game.layer].desc)
}
actions.toggleMute = () => {
  const muted = game.audio.toggleMute()
  document.getElementById('mute-btn').textContent = muted ? 'AUDIO: OFF' : 'AUDIO: ON'
}
actions.togglePause = () => {
  if (game.mode !== 'PLAY') return
  game.paused = !game.paused
  hud?.setPaused(game.paused)
}

const hud = new Hud(game, actions)
game.hud = hud

function startGame() {
  game.audio.init()
  game.audio.resume()
  resetSim(game)
  game.mode = 'PLAY'
  game.paused = false
  game.input.spaceHeld = false
  game.layer = 1
  env.setLayer(1)
  watch.setApp(0)
  hud.beginPlay()
  hud.setPaused(false)

  setTimeout(() => emit('radio', { text: 'RESWATCH · integridad 87% · batería 94% · LoRa 915 MHz operativo.', kind: 'sys', t: game.t }), 500)
  setTimeout(() => { if (game.mode === 'PLAY') emit('radio', { text: 'Colapso detectado. Sepultamiento estimado: 3.4 m. Escaneando gateways…', kind: 'alert', t: game.t }) }, 2100)
  setTimeout(() => { if (game.mode === 'PLAY') emit('radio', { text: 'Salvamento: repetimos, no detectamos señal. Si nos oyes, transmite en LoRa.', kind: 'gw', t: game.t }) }, 5200)
  setTimeout(() => { if (game.mode === 'PLAY') hud.toast('ARRASTRA SOBRE EL RELOJ O USA 1–4 PARA CAMBIAR DE APP · T TRANSMITE') }, 9000)
}

// ── Audio reactivo a eventos ───────────────────────────────────────────────
on('heartbeat', ({ hr }) => game.audio.heartbeat(hr))
on('breath-phase', ({ name }) => game.audio.breathPhase(name))
on('aftershock-warn', () => game.audio.alert())
on('aftershock', () => game.audio.quake())
on('fix', () => game.audio.fix())
on('rescue-phase', ({ phase }) => { if (phase === 3) game.audio.rescueArrive() })
on('strategy', ({ key }) => {
  if (key === 'MEDIC') game.audio.medDrop()
  if (key === 'CALM') game.audio.calmTone()
})
on('lose', () => game.audio.lose())
let lastChirp = 0
on('radio', () => {
  if (game.t - lastChirp > 0.6) { lastChirp = game.t; game.audio.radioChirp() }
})

// ── Fin de partida ─────────────────────────────────────────────────────────
let endTimer = null
function scheduleEnd(delay) {
  clearTimeout(endTimer)
  endTimer = setTimeout(() => {
    if (game.mode !== 'WINNING' && game.mode !== 'LOSING') return
    game.mode = 'END'
    computeScore(game)
    hud.showEnd(game)
  }, delay)
}
on('win', () => scheduleEnd(5200))
on('lose', () => scheduleEnd(4600))

// ── Cámara del visor ───────────────────────────────────────────────────────
const view = { yaw: 0, pitch: 0.015, targetYaw: 0, targetPitch: 0.015, roll: 0 }
let camT = 0

function updateCamera(dt) {
  camT += dt
  const v = game.vitals
  const qk = game.quake ? game.quake.shake : 0
  const micro = game.quake ? game.quake.microT : 0
  const beat = v ? Math.exp(-Math.pow((v.beatPhase - 0.31) / 0.06, 2)) : 0
  const breath = v ? v.guide.ring : 0.5

  // Suavizado del apuntado
  view.yaw = lerp(view.yaw, view.targetYaw, clamp(dt * 7, 0, 1))
  view.pitch = lerp(view.pitch, view.targetPitch, clamp(dt * 7, 0, 1))

  // Deriva por respiración + latido + microtemblores
  const bob = -0.012 * (breath - 0.5) + beat * 0.0022
  const swayX = Math.sin(camT * 0.45) * 0.006 + Math.sin(camT * 1.6) * 0.0015
  const shakeAmt = qk * 0.055 + micro * 0.006
  camera.position.set(
    swayX + rnd(-1, 1) * shakeAmt,
    1.30 + bob + rnd(-1, 1) * shakeAmt * 0.7,
    0.25 + rnd(-1, 1) * shakeAmt * 0.5
  )
  camera.rotation.set(
    view.pitch + Math.sin(camT * 0.6) * 0.004 + rnd(-1, 1) * shakeAmt * 0.5,
    view.yaw + rnd(-1, 1) * shakeAmt * 0.4,
    Math.sin(camT * 0.5) * 0.003 + rnd(-1, 1) * qk * 0.03
  )

  // Visión que se cierra con el pánico: FOV se estrecha (efecto túnel)
  const targetFov = 66 + (v ? (v.anxiety - 0.4) * 9 + (1 - v.visibility) * 10 : 0)
  camera.fov = lerp(camera.fov, clamp(targetFov, 58, 88), clamp(dt * 1.4, 0, 1))
  camera.updateProjectionMatrix()
}

// ── Entrada ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
let pointerDown = false
let watchDrag = false
let lastPointer = { x: 0, y: 0 }
let dragAccum = 0
let movedDist = 0
let cursorOverWatch = false

function setNdc(x, y) {
  const r = renderer.domElement.getBoundingClientRect()
  ndc.x = ((x - r.left) / r.width) * 2 - 1
  ndc.y = -((y - r.top) / r.height) * 2 + 1
}
function overWatch(x, y) {
  setNdc(x, y)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.intersectObjects(watch.hitMeshes, false).length > 0
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  game.audio.resume()
  pointerDown = true
  lastPointer = { x: e.clientX, y: e.clientY }
  movedDist = 0
  dragAccum = 0
  watchDrag = overWatch(e.clientX, e.clientY)
  renderer.domElement.setPointerCapture?.(e.pointerId)
})

renderer.domElement.addEventListener('pointermove', (e) => {
  const dx = e.clientX - lastPointer.x
  const dy = e.clientY - lastPointer.y
  lastPointer = { x: e.clientX, y: e.clientY }
  movedDist += Math.abs(dx) + Math.abs(dy)

  // Temblor de muñeca: la velocidad del puntero degrada la lectura barométrica
  if (game.input) game.input.mouseSpeed = clamp(Math.abs(dx) * 0.10 + Math.abs(dy) * 0.06, 0, 1)

  if (!pointerDown) {
    const over = overWatch(e.clientX, e.clientY)
    if (over !== cursorOverWatch) {
      cursorOverWatch = over
      renderer.domElement.style.cursor = over ? 'grab' : 'default'
    }
    return
  }

  if (watchDrag) {
    dragAccum += dx
    if (Math.abs(dragAccum) > 42) {
      watch.nextApp(dragAccum > 0 ? 1 : -1)
      dragAccum = 0
    }
    renderer.domElement.style.cursor = 'grabbing'
  } else {
    // Mirar alrededor (arrastrar el mundo)
    view.targetYaw = clamp(view.targetYaw - dx * 0.0026, -1.15, 1.15)
    view.targetPitch = clamp(view.targetPitch - dy * 0.0022, -0.55, 0.62)
  }
})

renderer.domElement.addEventListener('pointerup', (e) => {
  if (pointerDown && watchDrag && movedDist < 24) {
    watch.trigger()
  }
  pointerDown = false
  watchDrag = false
  renderer.domElement.style.cursor = cursorOverWatch ? 'grab' : 'default'
  // Decaimiento del temblor
  game.input.mouseSpeed = 0
})

renderer.domElement.addEventListener('pointerleave', () => {
  game.input.mouseSpeed = 0
})

renderer.domElement.addEventListener('wheel', (e) => {
  if (game.mode !== 'PLAY') return
  if (overWatch(e.clientX, e.clientY)) {
    e.preventDefault()
    watch.nextApp(e.deltaY > 0 ? 1 : -1)
  }
}, { passive: false })

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())

// Botón de respiración táctil (y clic sostenido con ratón)
const breathWrap = document.getElementById('breath-wrap')
breathWrap.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  game.audio.resume()
  game.input.spaceHeld = true
  breathWrap.setPointerCapture?.(e.pointerId)
})
const releaseBreath = () => { game.input.spaceHeld = false }
breathWrap.addEventListener('pointerup', releaseBreath)
breathWrap.addEventListener('pointercancel', releaseBreath)
breathWrap.addEventListener('pointerleave', (e) => { if (e.buttons === 0) releaseBreath() })
window.addEventListener('blur', releaseBreath)

// Teclado
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    game.audio.resume()
    if (!e.repeat) game.input.spaceHeld = true
    return
  }
  if (e.repeat) return
  switch (e.key.toLowerCase()) {
    case 't':
      if (game.mode === 'PLAY') { watch.setApp(3); watch.trigger() }
      break
    case 'l': actions.cycleLayer(); break
    case 'm': actions.toggleMute(); break
    case 'p': actions.togglePause(); break
    case '1': case '2': case '3': case '4':
      if (game.mode === 'PLAY') watch.setApp(Number(e.key) - 1)
      break
    case 'arrowright': if (game.mode === 'PLAY') watch.nextApp(1); break
    case 'arrowleft': if (game.mode === 'PLAY') watch.nextApp(-1); break
    case 'r':
      if (game.mode === 'END') startGame()
      break
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') game.input.spaceHeld = false
})
window.addEventListener('blur', () => { game.input.spaceHeld = false; if (game.mode === 'PLAY' && !game.paused) actions.togglePause() })

// ── Redimensionado ─────────────────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
}
window.addEventListener('resize', onResize)

// ── Bucle principal ────────────────────────────────────────────────────────
let last = performance.now()
let frameCount = 0
game.input.mouseSpeed = 0
hud.showMenu()
env.setLayer(1)
game.mode = 'MENU'

function frame(now) {
  const dtRaw = (now - last) / 1000
  last = now
  const dt = Math.min(dtRaw, 0.05)

  if ((game.mode === 'PLAY' || game.mode === 'WINNING' || game.mode === 'LOSING') && !game.paused) {
    simUpdate(game, dt)
  }

  // Decaimiento del temblor si no hay movimiento
  game.input.mouseSpeed = Math.max(0, game.input.mouseSpeed - dt * 1.4)

  env.update(dt, game)
  watch.update(dt, game)
  holo.update(dt, game)
  game.audio.update(dt, game)
  hud.update(dt, game)
  updateCamera(dt)

  renderer.render(scene, camera)
  frameCount++
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// Expuesto para depuración en consola
window.RESWATCH = { game, env, watch, holo, hud, startGame, THREE }
