// ─────────────────────────────────────────────────────────────────────────────
// holograms.js — Capa holográfica de Merged Reality:
//  · 3 gateways LoRa con rayos de triangulación y retícula de precisión.
//  · Dron explorador que desciende al despacharse la unidad.
//  · Dron de rescate cuya FORMA depende de la estrategia (MEDIC/CALM/HEAVY/RAPID).
//  · Pulsos de paquete, anillos de fijación y túnel de extracción con progreso.
// Todos los materiales son aditivos, sin escritura de profundidad, para que se
// lean como proyecciones sobre los escombros.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { clamp, lerp, on, CFG } from '../state.js'
import { glowTexture } from './util.js'

const GW_POS = [
  new THREE.Vector3(-6.4, 0, -11.4),
  new THREE.Vector3(7.0, 0, -10.2),
  new THREE.Vector3(1.4, 0, -16.6)
]
const PLAYER = new THREE.Vector3(0.85, 0, -1.7)

class DynLabel {
  constructor(text, opts = {}) {
    this.opts = opts
    this.text = null
    const c = document.createElement('canvas')
    c.width = 512; c.height = 64
    this.canvas = c
    this.ctx = c.getContext('2d')
    this.tex = new THREE.CanvasTexture(c)
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.95 })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.scale.set(0.052 * 512 * 0.55, 0.052 * 64 * 0.55, 1)
    this.setText(text)
  }
  setText(t) {
    if (t === this.text) return
    this.text = t
    const { ctx, canvas } = this
    const color = this.opts.color || '#8ff6ff'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(5,18,26,0.72)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.8
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    // Ajuste automático: la etiqueta nunca desborda el lienzo
    let size = this.opts.size || 34
    const family = 'ui-monospace, monospace'
    const maxW = canvas.width - 28
    ctx.font = `700 ${size}px ${family}`
    while (size > 15 && ctx.measureText(t).width > maxW) {
      size -= 1
      ctx.font = `700 ${size}px ${family}`
    }
    ctx.textBaseline = 'middle'
    ctx.fillText(t, 14, canvas.height / 2 + 2)
    this.tex.needsUpdate = true
  }
}

export class Holograms {
  constructor(scene, camera, game) {
    this.scene = scene
    this.camera = camera
    this.g = game
    this.t = 0
    this.group = new THREE.Group()
    scene.add(this.group)
    this.labels = new THREE.Group()
    this.group.add(this.labels)

    this._playerBeacon()
    this._gateways()
    this._reticle()
    this._pulses()
    this._tunnel()
    this._makeHolo(this.group)
    this._wireEvents()
  }

  // Los hologramas son proyecciones aditivas: se dibujan sobre la geometría
  _makeHolo(root) {
    root.traverse((o) => {
      if (!o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (m.isSpriteMaterial) continue
        m.depthTest = false
        m.needsUpdate = true
      }
    })
  }

  // Reinicio de partida: retirar drones y estados de una run anterior
  resetRun() {
    if (this.scout) { this.group.remove(this.scout.grp); this.scout = null }
    if (this.rescueDrone) { this.group.remove(this.rescueDrone.grp); this.rescueDrone = null }
    this.medicCapsule = null
    this.calmRings = null
    this.drillBit = null
    this.ladder = null
    this.gws.forEach((gw, i) => {
      gw.pulse = 0; gw.active = false; gw.hits = 0
      gw.ray.material.opacity = 0
      gw.label.setText(`GW-0${i + 1} · ESCUCHA`)
    })
    this.pulses.forEach((p) => { p.life = 0; p.mesh.visible = false })
    this.rings.forEach((r) => { r.life = 0; r.mesh.visible = false })
    this.accLabel.setText('SIN FIJACIÓN')
    this.reticle.visible = false
  }

  // ── Baliza del superviviente ───────────────────────────────────────────
  _playerBeacon() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x4dff9e, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
    this.beaconBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.10, 2.6, 16, 1, true), mat)
    this.beaconBeam.position.copy(PLAYER).add(new THREE.Vector3(0, 1.3, 0))
    this.group.add(this.beaconBeam)

    this.beaconRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 48), new THREE.MeshBasicMaterial({
      color: 0x4dff9e, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    }))
    this.beaconRing.rotation.x = -Math.PI / 2
    this.beaconRing.position.copy(PLAYER).add(new THREE.Vector3(0, 0.03, 0))
    this.group.add(this.beaconRing)

    this.youLabel = new DynLabel('TÚ · SENSORES', { color: '#7dffc4' })
    this.youLabel.sprite.position.set(0.85, 2.05, -1.7)
    this.labels.add(this.youLabel.sprite)
  }

  // ── Gateways LoRa ──────────────────────────────────────────────────────
  _gateways() {
    this.gws = []
    GW_POS.forEach((pos, i) => {
      const color = 0x35e6ff
      const grp = new THREE.Group()
      grp.position.copy(pos)

      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 7, 8, 1, true), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, wireframe: true
      }))
      tower.position.y = 3.5
      grp.add(tower)

      const base = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 48), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      }))
      base.rotation.x = -Math.PI / 2
      base.position.y = 0.04
      grp.add(base)

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
      halo.scale.set(1.6, 1.6, 1)
      halo.position.y = 7
      grp.add(halo)

      // Rayo de triangulación hacia el superviviente
      const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.6, 0), PLAYER.clone().sub(pos).setY(0.6)])
      const ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }))
      grp.add(ray)

      const lbl = new DynLabel(`GW-0${i + 1} · ESCUCHA`, { color: '#8ff6ff' })
      lbl.sprite.position.y = 7.6
      lbl.sprite.scale.set(0.052 * 512 * 0.5, 0.052 * 64 * 0.5, 1)
      grp.add(lbl.sprite)

      this.group.add(grp)
      this.gws.push({ grp, tower, base, halo, ray, label: lbl, pos, pulse: 0, hits: 0, active: false })
    })
  }

  // ── Retícula de precisión (triangulación) ──────────────────────────────
  _reticle() {
    this.reticle = new THREE.Group()
    this.reticle.position.copy(PLAYER)
    this.reticle.position.y = 0.02
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    this.accRing = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.0, 64), ringMat)
    this.accRing.rotation.x = -Math.PI / 2
    this.reticle.add(this.accRing)
    this.accRing2 = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.88, 64), ringMat.clone())
    this.accRing2.rotation.x = -Math.PI / 2
    this.reticle.add(this.accRing2)

    // Cruz
    const crossMat = new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.4, 0, 0), new THREE.Vector3(1.4, 0, 0)])
      const line = new THREE.Line(g, crossMat)
      line.rotation.y = i ? Math.PI / 2 : 0
      this.reticle.add(line)
    }
    this.group.add(this.reticle)

    this.accLabel = new DynLabel('SIN FIJACIÓN', { color: '#ffb347' })
    this.accLabel.sprite.position.set(-1.05, 1.18, -2.5)
    this.accLabel.sprite.scale.set(0.052 * 512 * 0.42, 0.052 * 64 * 0.42, 1)
    this.group.add(this.accLabel.sprite)

    this.depthLabel = new DynLabel('PROF. -- m', { color: '#8ff6ff' })
    this.depthLabel.sprite.position.set(2.5, 0.92, -2.6)
    this.depthLabel.sprite.scale.set(0.052 * 512 * 0.4, 0.052 * 64 * 0.4, 1)
    this.group.add(this.depthLabel.sprite)
  }

  // ── Pulsos de paquete LoRa ─────────────────────────────────────────────
  _pulses() {
    this.pulses = []
    const geo = new THREE.SphereGeometry(0.09, 10, 10)
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9df7ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      m.visible = false
      this.group.add(m)
      this.pulses.push({ mesh: m, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 1 })
    }
    this.rings = []
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({
        color: 0x35e6ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      }))
      ring.rotation.x = -Math.PI / 2
      ring.visible = false
      this.group.add(ring)
      this.rings.push({ mesh: ring, life: 0 })
    }
  }

  // ── Túnel de extracción (progreso) ─────────────────────────────────────
  _tunnel() {
    this.tunnel = new THREE.Group()
    this.tunnelRings = []
    const N = 10
    for (let i = 0; i < N; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 6, 40), new THREE.MeshBasicMaterial({
        color: 0x35e6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
      }))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(PLAYER.x, 0.32 + i * 0.21, PLAYER.z - 0.2)
      this.tunnel.add(ring)
      this.tunnelRings.push(ring)
    }
    this.group.add(this.tunnel)

    this.progressLabel = new DynLabel('EXTRACCIÓN 0%', { color: '#35e6ff' })
    this.progressLabel.sprite.position.set(PLAYER.x - 0.25, 2.15, PLAYER.z - 1.5)
    this.progressLabel.sprite.scale.set(0.052 * 512 * 0.5, 0.052 * 64 * 0.5, 1)
    this.group.add(this.progressLabel.sprite)
  }

  // ── Eventos del juego ──────────────────────────────────────────────────
  _wireEvents() {
    on('packet-tx', ({ pkt, airtime }) => {
      this._spawnPulse(airtime)
      if (this.g.audio) this.g.audio.blip(880, 0.06, 0.07)
    })
    on('packet-landed', ({ delivered, gws, n }) => {
      let any = false
      gws?.forEach((hit, i) => {
        if (!hit) return
        any = true
        this.gws[i].pulse = 1
        this.gws[i].hits++
        this.gws[i].active = true
      })
      if (!any) return
      if (this.g.audio) this.g.audio.blip(n >= 3 ? 1240 : 990, 0.09, 0.07)
      this.gws.forEach((gw) => {
        gw.label.setText(gw.active ? `GW-0${this.gws.indexOf(gw) + 1} · RX ${gw.hits}` : gw.label.text)
      })
    })
    on('fix', ({ accuracy }) => {
      this._fixFlash()
      this.accLabel.setText(`±${accuracy.toFixed(1)} m · FIJADO`)
      this.accLabel.opts.color = '#4dff9e'
      this.accLabel.sprite.material.color.setHex(0xffffff)
    })
    on('rescue-phase', ({ phase }) => {
      if (phase >= 3) this._spawnScout()
    })
    on('strategy', ({ key, strategy }) => this._spawnRescueDrone(key, strategy))
    on('contact', () => this._contact())
    on('sim-reset', () => this.resetRun())
  }

  _spawnPulse(airtime) {
    const p = this.pulses.find((x) => x.life <= 0)
    if (!p) return
    p.life = 1
    p.dur = clamp(airtime, 0.4, 3)
    p.from.copy(PLAYER).add(new THREE.Vector3(0, 0.5, 0))
    p.to.copy(GW_POS[(Math.random() * GW_POS.length) | 0]).setY(4.5)
    p.mesh.visible = true
  }

  _fixFlash() {
    for (let i = 0; i < 3; i++) {
      const r = this.rings[i]
      if (r.life > 0) continue
      r.life = 1
      r.mesh.position.copy(PLAYER).setY(0.06)
      r.mesh.visible = true
      break
    }
    this.gws.forEach((gw) => { gw.ray.material.opacity = 0.55 })
  }

  // ── Dron explorador ────────────────────────────────────────────────────
  _makeDrone(colorHex, scale = 1) {
    const grp = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    const wire = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false })

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), wire)
    grp.add(core)
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), mat)
    grp.add(inner)

    const rotors = []
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.012), mat)
      arm.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2)
      arm.rotation.y = -a
      grp.add(arm)
      const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 5, 24), wire)
      rotor.position.set(Math.cos(a) * 0.36, 0.02, Math.sin(a) * 0.36)
      rotor.rotation.x = Math.PI / 2
      grp.add(rotor)
      rotors.push(rotor)
    }

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: colorHex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.scale.set(1.7, 1.7, 1)
    grp.add(glow)

    grp.scale.setScalar(scale)
    grp.userData = { core, inner, rotors, glow, colorHex }
    return grp
  }

  _spawnScout() {
    if (this.scout) return
    const d = this._makeDrone(0x35e6ff, 1.15)
    d.position.set(1.2, 11, -12)
    this.group.add(d)
    const lbl = new DynLabel('SCOUT-01 · EN RUTA', { color: '#8ff6ff' })
    lbl.sprite.position.set(0, 0.75, 0)
    lbl.sprite.scale.set(0.052 * 512 * 0.5, 0.052 * 64 * 0.5, 1)
    d.add(lbl.sprite)
    this.scout = { grp: d, label: lbl, state: 'INBOUND', t: 0 }
    this._makeHolo(d)

    // Cono de escaneo
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5.2, 28, 1, true), new THREE.MeshBasicMaterial({
      color: 0x35e6ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    }))
    cone.position.y = -2.6
    cone.rotation.x = Math.PI
    d.add(cone)
    this.scoutCone = cone
  }

  // ── Dron de rescate según estrategia ───────────────────────────────────
  _spawnRescueDrone(key, strategy) {
    if (this.rescueDrone) { this.group.remove(this.rescueDrone.grp); this.rescueDrone = null }
    this.strategyKey = key
    const color = strategy?.color ?? 0x4dff9e
    const d = this._makeDrone(color, 1.5)
    d.position.set(0.55, 2.35, -3.5)
    this.group.add(d)

    const lbl = new DynLabel(`${strategy?.name ?? 'RESCATE'} · EN SITIO`, { color: '#' + color.toString(16).padStart(6, '0') })
    lbl.sprite.position.set(0, 0.72, 0)
    lbl.sprite.scale.set(0.052 * 512 * 0.55, 0.052 * 64 * 0.55, 1)
    d.add(lbl.sprite)

    // Haz de trabajo
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.6, 2.0, 24, 1, true), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    }))
    beam.position.y = -1.0
    d.add(beam)

    const extra = new THREE.Group()
    d.add(extra)

    if (key === 'MEDIC') {
      // Cápsula de oxígeno que desciende por un cable
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2.2, 6), new THREE.MeshBasicMaterial({ color: 0x9fffcf, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
      cable.position.y = -1.4
      extra.add(cable)
      const capsule = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4dff9e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }))
      capsule.position.y = -2.5
      extra.add(capsule)
      this.medicCapsule = capsule
    } else if (key === 'CALM') {
      // Anillos de respiración sincronizados con la guía
      this.calmRings = []
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 6, 48), new THREE.MeshBasicMaterial({
          color: 0x9d7bff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false
        }))
        ring.rotation.x = Math.PI / 2
        ring.position.set(0, -1.2 - i * 0.42, -0.8)
        extra.add(ring)
        this.calmRings.push(ring)
      }
    } else if (key === 'HEAVY') {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.5, wireframe: true }))
      arm.position.y = -1.3
      extra.add(arm)
      const bit = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 10), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }))
      bit.position.y = -2.6
      bit.rotation.x = Math.PI
      extra.add(bit)
      this.drillBit = bit
    } else {
      // Escalera de luz / rápel
      const ladder = new THREE.Group()
      for (let i = 0; i < 8; i++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: 0x35e6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
        rung.position.set(0, -0.4 - i * 0.36, 0)
        ladder.add(rung)
      }
      extra.add(ladder)
      this.ladder = ladder
    }

    this.rescueDrone = { grp: d, label: lbl, beam, extra, color, t: 0 }
    this._makeHolo(d)
  }

  _contact() {
    if (this.g.audio) this.g.audio.win()
    this.contactFlash = 1
    for (const r of this.rings) { r.life = 0 }
    this._fixFlash()
  }

  // ── Frame ──────────────────────────────────────────────────────────────
  update(dt, game) {
    this.t += dt
    const layerVisible = game.layer > 0
    this.group.visible = layerVisible
    if (!layerVisible) return

    const v = game.vitals
    const lora = game.lora

    // Baliza del jugador
    const survive = game.mode !== 'LOSING'
    this.beaconBeam.material.opacity = (survive ? 0.14 : 0.06) + Math.sin(this.t * 2.4) * 0.05
    this.beaconRing.scale.setScalar(1 + (Math.sin(this.t * 2.4) * 0.5 + 0.5) * 0.9)
    this.beaconRing.material.opacity = 0.45 * (1 - ((this.t * 0.5) % 1))

    // Gateways
    const opacityMul = game.layer === 2 ? 1.25 : 1
    this.gws.forEach((gw, i) => {
      gw.pulse = Math.max(0, gw.pulse - dt * 1.4)
      gw.tower.material.opacity = (0.16 + gw.pulse * 0.7) * opacityMul
      gw.halo.material.opacity = (0.25 + gw.pulse * 0.9) * opacityMul
      gw.halo.scale.setScalar(1.4 + gw.pulse * 1.6)
      gw.tower.rotation.y += dt * 0.15
      const hasFix = lora && lora.accuracy <= CFG.lora.dispatchAccuracy
      gw.ray.material.opacity = lerp(gw.ray.material.opacity, hasFix ? 0.35 : gw.active ? 0.12 : 0.02, clamp(dt * 2, 0, 1))
      gw.base.material.opacity = (0.25 + gw.pulse * 0.8) * opacityMul
    })

    // Retícula de precisión
    if (lora) {
      const acc = clamp(lora.accuracy, 0.4, 12)
      this.reticle.visible = lora.accuracy <= 11
      this.accRing.scale.setScalar(acc)
      this.accRing2.scale.setScalar(acc * 0.97)
      const locked = lora.accuracy <= CFG.lora.dispatchAccuracy
      const col = locked ? 0x4dff9e : 0xffb347
      this.accRing.material.color.setHex(col)
      this.accRing2.material.color.setHex(col)
      this.accRing.material.opacity = (locked ? 0.55 : 0.35) + Math.sin(this.t * 3) * 0.08
      const label = lora.accuracy >= 40 ? 'SIN FIJACIÓN' : locked ? `±${lora.accuracy.toFixed(1)} m · FIJADO` : `±${lora.accuracy.toFixed(1)} m`
      this.accLabel.setText(label)
      this.accLabel.opts.color = locked ? '#4dff9e' : '#ffb347'
    }
    if (game.baro) {
      this.depthLabel.setText(`PROF. ${game.baro.measuredDepth.toFixed(1)} m · ${game.baro.calibrated ? 'CAL' : 'S/CAL'}`)
    }
    this.youLabel.setText(`TÚ · SpO₂ ${v ? v.spo2.toFixed(0) : '--'}% · ${game.vitals?.phaseName ?? ''}`)

    // Pulsos
    for (const p of this.pulses) {
      if (p.life <= 0) { p.mesh.visible = false; continue }
      p.life -= dt / p.dur
      const k = clamp(1 - p.life, 0, 1)
      p.mesh.position.lerpVectors(p.from, p.to, k)
      p.mesh.material.opacity = Math.sin(k * Math.PI) * 0.9
      if (p.life <= 0) p.mesh.visible = false
    }
    for (const r of this.rings) {
      if (r.life <= 0) { r.mesh.visible = false; continue }
      r.life -= dt * 0.9
      const s = 1 + (1 - r.life) * 9
      r.mesh.scale.set(s, s, s)
      r.mesh.material.opacity = Math.max(0, r.life) * 0.5
      if (r.life <= 0) r.mesh.visible = false
    }

    // Dron explorador
    if (this.scout) {
      const s = this.scout
      s.t += dt
      const target = new THREE.Vector3(1.9, 3.4, -4.4)
      if (s.state === 'INBOUND') {
        s.grp.position.lerp(target, clamp(dt * 0.34, 0, 1))
        s.grp.rotation.y += dt * 0.8
        s.label.setText('SCOUT-01 · EN RUTA')
        if (s.grp.position.distanceTo(target) < 0.3) { s.state = 'HOVER'; s.label.setText('SCOUT-01 · ESCANEANDO') }
      } else if (s.state === 'HOVER') {
        s.grp.position.y = target.y + Math.sin(this.t * 1.4) * 0.12
        s.grp.position.x = target.x + Math.sin(this.t * 0.7) * 0.25
        s.grp.rotation.y += dt * 0.25
        if (game.rescue && game.rescue.phaseIdx >= 6) {
          s.label.setText('SCOUT-01 · APOYO')
        }
      }
      s.grp.userData.rotors.forEach((r, i) => { r.rotation.z += dt * (18 + i) })
      const pulse = 0.5 + Math.sin(this.t * 6) * 0.5
      s.grp.userData.glow.material.opacity = 0.4 + pulse * 0.5
      if (this.scoutCone) this.scoutCone.material.opacity = 0.035 + pulse * 0.03
    }

    // Dron de rescate
    if (this.rescueDrone) {
      const r = this.rescueDrone
      r.t += dt
      r.grp.position.y = 2.35 + Math.sin(this.t * 1.1) * 0.08
      r.grp.rotation.y += dt * 0.15
      r.grp.userData.rotors.forEach((rot, i) => { rot.rotation.z += dt * (14 + i * 2) })
      r.grp.userData.glow.material.opacity = 0.55 + Math.sin(this.t * 3) * 0.2
      const prog = game.rescue ? game.rescue.progress / 100 : 0
      r.beam.material.opacity = 0.06 + prog * 0.12
      r.beam.scale.y = 1 + prog * 0.35

      if (this.medicCapsule) {
        this.medicCapsule.position.y = -2.5 + Math.sin(this.t * 1.6) * 0.12
        this.medicCapsule.material.opacity = 0.6 + Math.sin(this.t * 4) * 0.25
      }
      if (this.calmRings) {
        const ringState = game.vitals ? game.vitals.guide.ring : 0.5
        this.calmRings.forEach((ring, i) => {
          const phase = (this.t * 0.35 + i * 0.22) % 1
          const s = 0.5 + phase * 2.4 * (0.6 + ringState * 0.7)
          ring.scale.set(s, s, s)
          ring.material.opacity = (1 - phase) * 0.45
          ring.position.y = -1.2 - i * 0.42
        })
      }
      if (this.drillBit) {
        this.drillBit.rotation.y += dt * 22
        this.drillBit.position.y = -2.6 - prog * 1.4 + Math.sin(this.t * 10) * 0.02
      }
      if (this.ladder) this.ladder.position.y = -prog * 0.3
      r.label.setText(`${game.rescue?.strategyDef?.name ?? 'RESCATE'} · ${game.rescue?.phase?.slice(0, 22) ?? ''}`)
    }

    // Túnel de extracción
    const prog = game.rescue ? game.rescue.progress : 0
    this.tunnelRings.forEach((ring, i) => {
      const active = prog > (i / this.tunnelRings.length) * 100
      const local = clamp((prog - (i / this.tunnelRings.length) * 100) / (100 / this.tunnelRings.length), 0, 1)
      ring.material.opacity = active ? 0.18 + local * 0.55 : 0
      ring.rotation.z += dt * (0.2 + i * 0.03)
      const s = 1 + local * 0.15
      ring.scale.set(s, s, s)
    })
    this.progressLabel.setText(game.rescue && game.rescue.phaseIdx >= 6 ? `EXTRACCIÓN ${prog.toFixed(0)}%` : `RESCATE · ${game.rescue?.phase ?? 'EN ESPERA'}`)
    this.progressLabel.sprite.visible = game.rescue && game.rescue.phaseIdx >= 3

    // Aviso de réplica
    if (game.quake && game.quake.warnActive) {
      const f = (Math.sin(this.t * 18) * 0.5 + 0.5)
      this.beaconRing.material.opacity = 0.2 + f * 0.6
      this.beaconRing.scale.setScalar(1 + f * 1.4)
    }
  }
}
