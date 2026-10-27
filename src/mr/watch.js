// ─────────────────────────────────────────────────────────────────────────────
// watch.js — RESWATCH 3D: el dispositivo que el jugador "lleva" en el visor MR.
//  · Pantalla circular dibujada en canvas: apps VITAL / BARO / LORA / SOS.
//  · El bisel gira al cambiar de app (arrastrar/rueda sobre el reloj); pulsar
//    la pantalla en la app SOS transmite el paquete LoRa.
//  · Proyecta un holograma ECG sobre la muñeca y un anillo RF cuya
//    estabilidad depende de la calidad de enlace (respiración del jugador).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { clamp, lerp, rnd } from '../state.js'
import { glowTexture } from './util.js'

export const APPS = ['VITAL', 'BARO', 'LORA', 'SOS']

const CYAN = '#35e6ff'
const GREEN = '#4dff9e'
const AMBER = '#ffb347'
const RED = '#ff3b5c'
const DIM = '#5d7c8c'

export class Watch {
  constructor(camera, game) {
    this.g = game
    this.group = new THREE.Group()
    this.group.position.set(0.02, -0.185, -0.52)
    this.group.rotation.set(0.32, -0.04, 0.02)
    this.group.scale.setScalar(0.85)
    camera.add(this.group)

    this.appIndex = 0
    this.g.watchApp = APPS[0]
    this.bezelAngle = 0
    this.bezelTarget = 0
    this.flash = 0
    this.screenAcc = 0
    this.holoAcc = 0
    this.time = 0
    this.shakeT = 0

    this._build()
    this._drawScreen()
    this._drawHolo(0)
  }

  // ── Geometría del dispositivo ──────────────────────────────────────────
  _build() {
    // Caja metálica
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x2b333c, metalness: 0.92, roughness: 0.32 })
    const metal = new THREE.MeshStandardMaterial({ color: 0x8c9aa8, metalness: 0.95, roughness: 0.22 })
    const rubber = new THREE.MeshStandardMaterial({ color: 0x12161b, roughness: 0.9, metalness: 0.05 })

    const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.053, 0.017, 48), caseMat)
    caseMesh.rotation.x = Math.PI / 2
    this.group.add(caseMesh)
    this.caseMesh = caseMesh

    const back = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), caseMat)
    back.rotation.x = -Math.PI / 2
    back.position.z = -0.008
    back.scale.z = 0.5
    this.group.add(back)

    // Bisel giratorio
    this.bezel = new THREE.Group()
    this.bezel.position.z = 0.004
    this.group.add(this.bezel)
    const bezelRing = new THREE.Mesh(new THREE.TorusGeometry(0.0535, 0.006, 14, 80), metal)
    this.bezel.add(bezelRing)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.006, 0.0016), metal)
      tick.position.set(Math.cos(a) * 0.0535, Math.sin(a) * 0.0535, 0.002)
      tick.rotation.z = a
      this.bezel.add(tick)
    }
    // Marca superior (índice de la app activa)
    const notch = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.011, 3), new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.6 }))
    notch.position.set(0, 0.0565, 0.004)
    notch.rotation.z = Math.PI
    this.group.add(notch)
    this.notch = notch

    // Pantalla
    this.screenCanvas = document.createElement('canvas')
    this.screenCanvas.width = 512
    this.screenCanvas.height = 512
    this.screenCtx = this.screenCanvas.getContext('2d')
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas)
    this.screenTex.colorSpace = THREE.SRGBColorSpace
    const screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, transparent: true })
    const screen = new THREE.Mesh(new THREE.CircleGeometry(0.0465, 64), screenMat)
    screen.position.z = 0.0102
    this.group.add(screen)
    this.screen = screen

    // Zona táctil invisible (más generosa para clics)
    const hit = new THREE.Mesh(new THREE.CircleGeometry(0.056, 24), new THREE.MeshBasicMaterial({ visible: false }))
    hit.position.z = 0.012
    this.group.add(hit)
    this.hitMeshes = [hit, caseMesh, this.bezel.children[0]]

    // Corona lateral
    this.crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.013, 16), metal)
    this.crown.rotation.z = Math.PI / 2
    this.crown.position.set(0.06, 0.008, 0)
    this.group.add(this.crown)

    // Correas
    for (const dir of [1, -1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.16, 0.008), rubber)
      strap.position.set(0, dir * 0.135, -0.006)
      strap.rotation.x = dir * 0.12
      this.group.add(strap)
    }

    // Halo de emisión RF en el canto
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.056, 0.075, 64),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x35e6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    )
    this.halo.position.z = 0.002
    this.group.add(this.halo)

    // Anillo RF holográfico (estabilidad = calidad de enlace)
    this.rfRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.115, 0.0016, 6, 72),
      new THREE.MeshBasicMaterial({ color: 0x35e6ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    this.rfRing.position.set(0, 0.035, -0.01)
    this.rfRing.rotation.x = Math.PI / 2.35
    this.group.add(this.rfRing)

    // Segundo anillo (contrarrotación)
    this.rfRing2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.001, 6, 56),
      new THREE.MeshBasicMaterial({ color: 0x9d7bff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    this.rfRing2.position.set(0, 0.02, -0.005)
    this.rfRing2.rotation.x = Math.PI / 2.6
    this.group.add(this.rfRing2)

    // Holograma ECG proyectado sobre la muñeca
    this.holoCanvas = document.createElement('canvas')
    this.holoCanvas.width = 512
    this.holoCanvas.height = 192
    this.holoCtx = this.holoCanvas.getContext('2d')
    this.holoTex = new THREE.CanvasTexture(this.holoCanvas)
    this.holoTex.colorSpace = THREE.SRGBColorSpace
    this.holo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.255, 0.098),
      new THREE.MeshBasicMaterial({ map: this.holoTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    )
    this.holo.position.set(0, 0.112, -0.015)
    this.holo.rotation.x = -0.32
    this.group.add(this.holo)

    // Luz emitida por la pantalla del reloj
    this.light = new THREE.PointLight(0x35e6ff, 1.1, 2.6, 2)
    this.light.position.set(0, -0.02, 0.12)
    this.group.add(this.light)

    // Luz de relleno del visor (ilumina la muñeca y el bisel metálico)
    this.fill = new THREE.PointLight(0xd6ecff, 3.2, 4.5, 2)
    this.fill.position.set(0.05, 0.32, 0.25)
    this.group.parent.add(this.fill)
  }

  // ── Apps ───────────────────────────────────────────────────────────────
  setApp(i) {
    const n = APPS.length
    this.appIndex = ((i % n) + n) % n
    this.bezelTarget = -this.appIndex * (Math.PI / 2)
    this.g.watchApp = APPS[this.appIndex]
    this._drawScreen()
  }

  nextApp(dir = 1) {
    this.setApp(this.appIndex + dir)
    if (this.g.audio) this.g.audio.blip(560, 0.05, 0.05)
  }

  trigger() {
    if (this.g.mode !== 'PLAY') return false
    if (APPS[this.appIndex] === 'SOS') {
      const pkt = this.g.lora.transmit()
      if (pkt) this.flash = 1
      return !!pkt
    }
    this.nextApp(1)
    return false
  }

  // ── Actualización ──────────────────────────────────────────────────────
  update(dt, game) {
    this.time += dt
    const v = game.vitals
    const lora = game.lora
    const q = lora ? lora.q : 0.4
    const tremor = game.baro ? game.baro.tremor : 0
    const shake = game.quake ? game.quake.shake : 0

    // Bisel con muelle
    this.bezelAngle = lerp(this.bezelAngle, this.bezelTarget, clamp(dt * 7, 0, 1))
    this.bezel.rotation.z = this.bezelAngle

    // Micro-vibración del dispositivo por temblor de muñeca y réplicas
    const jx = (Math.random() - 0.5) * (tremor * 0.0035 + shake * 0.006)
    const jy = (Math.random() - 0.5) * (tremor * 0.0035 + shake * 0.006)
    this.group.position.set(0.02 + jx, -0.185 + jy, -0.52)
    this.group.rotation.z = 0.02 + Math.sin(this.time * 1.1) * 0.01 + tremor * Math.sin(this.time * 22) * 0.012

    // Latido visual
    const beat = v ? Math.exp(-Math.pow((v.beatPhase - 0.31) / 0.05, 2)) : 0
    this.flash = Math.max(0, this.flash - dt * 2.2)
    const glow = 0.18 + q * 0.35 + beat * 0.35 + this.flash * 1.4
    this.halo.material.opacity = clamp(glow * 0.75, 0, 1)
    this.halo.scale.setScalar(1 + beat * 0.06 + this.flash * 0.25)
    this.light.intensity = 0.8 + q * 0.8 + this.flash * 3 + beat * 0.5

    // Anillo RF: estable si q alto, caótico si la señal cae
    const showRF = game.layer > 0
    this.rfRing.visible = this.rfRing2.visible = showRF
    if (showRF) {
      const wobble = (1 - q) * 0.22
      this.rfRing.rotation.z += dt * (0.35 + q * 0.9)
      this.rfRing2.rotation.z -= dt * (0.5 + q * 0.5)
      this.rfRing.scale.setScalar(1 + Math.sin(this.time * 2.2) * 0.03 + rnd(wobble * 0.12))
      this.rfRing2.scale.setScalar(1 + Math.sin(this.time * 1.7 + 1) * 0.04 + rnd(wobble * 0.16))
      this.rfRing.material.opacity = clamp(0.10 + q * 0.55 + this.flash * 0.5, 0, 1)
      this.rfRing2.material.opacity = clamp(0.05 + q * 0.35, 0, 0.8)
      this.rfRing.position.y = 0.035 + Math.sin(this.time * 1.6) * 0.004
    }

    // Holograma ECG
    this.holo.visible = game.layer > 0
    this.holoAcc += dt
    if (this.holoAcc > 0.05) { this.holoAcc = 0; this._drawHolo(dt) }

    // Pantalla: 14 Hz es suficiente y ahorra CPU
    this.screenAcc += dt
    if (this.screenAcc > 0.07) { this.screenAcc = 0; this._drawScreen() }

    // El índice del bisel brilla más con buena señal
    this.notch.material.emissiveIntensity = 1 + q * 2 + this.flash * 4
  }

  // Jitter de la pantalla del reloj (refleja señal inestable)
  _q() { return this.g.lora ? this.g.lora.q : 0.5 }

  // ── Dibujo de pantalla ─────────────────────────────────────────────────
  _drawScreen() {
    const ctx = this.screenCtx
    const S = 512, R = 256
    const g = this.g
    const v = g.vitals, b = g.baro, l = g.lora
    const q = this._q()
    ctx.clearRect(0, 0, S, S)

    // Fondo circular
    const bg = ctx.createRadialGradient(R, R * 0.82, 10, R, R, R)
    bg.addColorStop(0, '#07202b')
    bg.addColorStop(0.7, '#04121a')
    bg.addColorStop(1, '#020a0f')
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.fill()

    // Rejilla + scanlines
    ctx.save()
    ctx.beginPath(); ctx.arc(R, R, R - 6, 0, Math.PI * 2); ctx.clip()
    ctx.strokeStyle = 'rgba(53,230,255,0.07)'; ctx.lineWidth = 1
    for (let i = 0; i < S; i += 26) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke()
    }
    for (let y = 0; y < S; y += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)'
      ctx.fillRect(0, y, S, 1)
    }
    ctx.restore()

    const app = APPS[this.appIndex]
    const accent = app === 'SOS' ? RED : app === 'BARO' ? AMBER : app === 'LORA' ? '#9d7bff' : CYAN

    // Cabecera
    ctx.font = '600 26px ui-monospace, monospace'
    ctx.fillStyle = accent
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(app, 62, 84)
    ctx.textAlign = 'right'
    ctx.fillStyle = DIM
    ctx.fillText('RESWATCH', 450, 84)
    // barra de estado
    ctx.fillStyle = 'rgba(93,124,140,0.25)'
    ctx.fillRect(62, 104, 388, 2)

    if (!v || !b || !l) { this._commitScreen(); return }

    if (app === 'VITAL') this._appVital(ctx, v, accent)
    else if (app === 'BARO') this._appBaro(ctx, b, accent)
    else if (app === 'LORA') this._appLora(ctx, l, q, accent)
    else this._appSOS(ctx, l, q, accent)

    // Indicadores inferiores
    ctx.textAlign = 'left'; ctx.font = '600 19px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText(`SpO₂ ${v.spo2.toFixed(0)}%`, 62, 448)
    ctx.textAlign = 'right'
    ctx.fillStyle = q > 0.55 ? GREEN : q > 0.3 ? AMBER : RED
    ctx.fillText(`RF ${(q * 100).toFixed(0)}%`, 450, 448)

    // Coherencia como arco inferior
    this._arc(ctx, R, R, 236, -Math.PI * 0.82, Math.PI * 0.82, v.coherence, accent === RED ? AMBER : accent, 5)

    this._commitScreen()
  }

  _commitScreen() {
    this.screenTex.needsUpdate = true
  }

  _arc(ctx, cx, cy, r, a0, a1, frac, color, width) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, a0, a1)
    ctx.strokeStyle = 'rgba(93,124,140,0.22)'
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.stroke()
    if (frac <= 0) return
    ctx.beginPath()
    ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * clamp(frac, 0, 1))
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
    ctx.lineCap = 'butt'
  }

  _appVital(ctx, v, accent) {
    const hr = Math.round(v.hr)
    const color = hr > 170 ? RED : hr > 130 ? AMBER : GREEN
    const beat = Math.exp(-Math.pow((v.beatPhase - 0.31) / 0.055, 2))
    const scale = 1 + beat * 0.10

    // Corazón
    const cx = 120, cy = 214
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(0, 16)
    ctx.bezierCurveTo(-30, -10, -20, -34, 0, -18)
    ctx.bezierCurveTo(20, -34, 30, -10, 0, 16)
    ctx.fill()
    ctx.restore()

    // BPM
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = color
    ctx.font = '700 128px ui-monospace, monospace'
    ctx.fillText(String(hr), 150, 246)
    ctx.font = '600 26px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText('BPM', 154, 284)

    // ECG
    const x0 = 62, x1 = 450, y = 322
    ctx.strokeStyle = 'rgba(77,255,158,0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i <= 60; i++) {
      const x = x0 + ((x1 - x0) * i) / 60
      const p = ((i / 60) * 2 + v.beatPhase) % 1
      const val = v.ecgAt(p) * 26
      if (i === 0) ctx.moveTo(x, y - val); else ctx.lineTo(x, y - val)
    }
    ctx.stroke()

    // Coherencia
    ctx.font = '600 22px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.textAlign = 'left'
    ctx.fillText('COHERENCIA', 62, 384)
    this._bar(ctx, 236, 373, 214, 12, v.coherence, v.coherence > 0.55 ? GREEN : AMBER)
    ctx.textAlign = 'right'
    ctx.fillStyle = v.coherence > 0.55 ? GREEN : AMBER
    ctx.fillText(`${(v.coherence * 100).toFixed(0)}%`, 450, 384)

    // Fase respiratoria
    ctx.textAlign = 'left'
    ctx.font = '600 22px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText('RESP', 62, 416)
    ctx.fillStyle = CYAN
    ctx.fillText(v.phaseName, 150, 416)
  }

  _bar(ctx, x, y, w, h, frac, color) {
    ctx.fillStyle = 'rgba(93,124,140,0.22)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = color
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h)
  }

  _appBaro(ctx, b, accent) {
    const depth = Math.max(0, b.measuredDepth)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = b.calibrated ? '#35e6ff' : AMBER
    ctx.font = '700 132px ui-monospace, monospace'
    ctx.fillText(depth.toFixed(1), 62, 248)
    ctx.font = '600 30px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText('m', 300, 248)

    ctx.font = '600 22px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText('PROFUNDIDAD DE SEPULTAMIENTO', 62, 282)

    // Presión
    ctx.font = '600 24px ui-monospace, monospace'
    ctx.textAlign = 'left'; ctx.fillStyle = accent
    ctx.fillText('PRESIÓN', 62, 336)
    ctx.textAlign = 'right'; ctx.fillStyle = '#cfe9f2'
    ctx.fillText(`${b.smooth.toFixed(2)} hPa`, 450, 336)

    // Calibración
    ctx.textAlign = 'left'
    ctx.fillStyle = DIM
    ctx.fillText(b.calibrated ? 'CALIBRADO' : 'CALIBRANDO', 62, 386)
    this._bar(ctx, 250, 374, 200, 12, b.calibProgress, b.calibrated ? GREEN : AMBER)
    ctx.textAlign = 'right'
    ctx.fillStyle = b.calibrated ? GREEN : AMBER
    ctx.fillText(b.calibrated ? '✓' : `${(b.calibProgress * 100).toFixed(0)}%`, 450, 386)

    ctx.textAlign = 'left'
    ctx.font = '600 20px ui-monospace, monospace'
    ctx.fillStyle = b.calibrated ? DIM : AMBER
    ctx.fillText(b.calibrated ? 'Lectura estable · pulso firme' : 'Mantén el puño quieto y respira', 62, 420)
  }

  _appLora(ctx, l, q, accent) {
    // Anillo de calidad
    const cx = 256, cy = 238, r = 86
    this._arc(ctx, cx, cy, r, Math.PI * 0.75, Math.PI * 2.25, q, q > 0.55 ? GREEN : q > 0.3 ? AMBER : RED, 14)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = '#cfe9f2'
    ctx.font = '700 60px ui-monospace, monospace'
    ctx.fillText(`${(q * 100).toFixed(0)}`, cx, cy - 6)
    ctx.font = '600 22px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText('CALIDAD', cx, cy + 34)
    ctx.textAlign = 'center'
    ctx.fillStyle = accent
    ctx.font = '600 24px ui-monospace, monospace'
    ctx.fillText(`SF${l.sf} · ${l.rssi.toFixed(0)} dBm · ${l.snr.toFixed(1)} dB`, cx, 358)

    // Gateways
    ctx.textAlign = 'left'
    ctx.fillStyle = DIM
    ctx.font = '600 22px ui-monospace, monospace'
    ctx.fillText('GATEWAYS', 62, 402)
    for (let i = 0; i < 3; i++) {
      const hit = l.lastFixGws[i]
      ctx.beginPath()
      ctx.arc(196 + i * 40, 394, 9, 0, Math.PI * 2)
      ctx.fillStyle = hit ? GREEN : 'rgba(93,124,140,0.35)'
      ctx.fill()
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = DIM
    ctx.fillText(`TX ${l.packets.sent} · OK ${l.packets.delivered}`, 450, 402)
  }

  _appSOS(ctx, l, q, accent) {
    const ready = l.cooldown <= 0
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (ready ? 6 : 2))
    // Botón circular
    const cx = 256, cy = 244, r = 96
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = ready ? `rgba(255,59,92,${0.14 + pulse * 0.12})` : 'rgba(60,70,80,0.25)'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = ready ? `rgba(255,90,110,${0.55 + pulse * 0.45})` : 'rgba(93,124,140,0.35)'
    ctx.stroke()
    // Progreso de enfriamiento
    if (!ready) {
      const f = 1 - l.cooldownFrac
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f)
      ctx.strokeStyle = AMBER; ctx.lineWidth = 6; ctx.stroke()
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = ready ? '#ffd7dd' : DIM
    ctx.font = '700 34px ui-monospace, monospace'
    ctx.fillText(ready ? 'TRANSMITIR' : 'EN ESPERA', cx, cy - 10)
    ctx.font = '600 20px ui-monospace, monospace'
    ctx.fillStyle = DIM
    ctx.fillText(ready ? 'SOS · LoRa 915' : `${l.cooldown.toFixed(1)} s`, cx, cy + 30)

    // Fase del rescate
    const res = this.g.rescue
    ctx.font = '600 22px ui-monospace, monospace'
    ctx.fillStyle = res && res.phaseIdx > 0 ? GREEN : DIM
    ctx.fillText(res ? res.phase.slice(0, 24) : 'SIN RESCATE', 256, 386)
    ctx.fillStyle = DIM
    ctx.font = '600 20px ui-monospace, monospace'
    ctx.fillText(`${l.packets.delivered} paquetes entregados`, 256, 414)
  }

  // ── Holograma ECG sobre la muñeca ─────────────────────────────────────
  _drawHolo() {
    const ctx = this.holoCtx
    const W = 512, H = 192
    const v = this.g.vitals
    const q = this._q()
    ctx.clearRect(0, 0, W, H)
    if (!v) return
    ctx.fillStyle = 'rgba(4,18,26,0.35)'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = `rgba(53,230,255,${0.25 + q * 0.25})`
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

    // Onda ECG con solapamiento
    const hr = v.hr
    const p = v.beatPhase
    ctx.beginPath()
    for (let i = 0; i < W; i++) {
      const t = i / W
      const val = v.ecgAt((t * 1.6 + p) % 1)
      const y = H * 0.5 - val * H * 0.62
      if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y)
    }
    ctx.strokeStyle = hr > 165 ? 'rgba(255,59,92,0.95)' : hr > 130 ? 'rgba(255,179,71,0.9)' : 'rgba(77,255,158,0.9)'
    ctx.lineWidth = 3
    ctx.shadowColor = ctx.strokeStyle
    ctx.shadowBlur = 12
    ctx.stroke()
    ctx.shadowBlur = 0

    // Texto
    ctx.font = '700 40px ui-monospace, monospace'
    ctx.fillStyle = '#bff8ff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${Math.round(hr)}`, 16, 34)
    ctx.font = '600 18px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(143,246,255,0.7)'
    ctx.fillText('BPM', 104, 34)
    ctx.textAlign = 'right'
    ctx.fillText(`SpO₂ ${v.spo2.toFixed(0)}% · COH ${(v.coherence * 100).toFixed(0)}%`, W - 14, 34)

    // Scanlines holográficos
    for (let y = 0; y < H; y += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.14)'
      ctx.fillRect(0, y, W, 2)
    }
    this.holoTex.needsUpdate = true
  }
}
