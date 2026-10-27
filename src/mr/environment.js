// ─────────────────────────────────────────────────────────────────────────────
// environment.js — Escena física del colapso + capas de Merged Reality.
// Todo es procedural (sin assets externos): concreto, escombros instanciados,
// polvo en suspensión, haz de luz que entra por la grieta y superposiciones
// holográficas conmutables (Passthrough / Fusión / Diagnóstico).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { clamp, lerp, rnd } from '../state.js'
import { concreteTexture, dustTexture, glowTexture } from './util.js'

export class Environment {
  constructor(scene, camera, game) {
    this.scene = scene
    this.camera = camera
    this.g = game
    this.time = 0
    this.dustVel = null

    scene.background = new THREE.Color(0x05070c)
    scene.fog = new THREE.FogExp2(0x080c14, 0.055)

    this.physical = new THREE.Group()
    this.mrGroup = new THREE.Group()
    this.diagGroup = new THREE.Group()
    scene.add(this.physical, this.mrGroup, this.diagGroup)

    this._lights()
    this._floor()
    this._structure()
    this._rubble()
    this._dust()
    this._shaft()
    this._mrOverlay()

    this.setLayer(1)
  }

  // ── Luces ──────────────────────────────────────────────────────────────
  _lights() {
    this.hemi = new THREE.HemisphereLight(0x51698a, 0x0a0c10, 0.85)
    this.scene.add(this.hemi)

    this.moon = new THREE.DirectionalLight(0x9fb6d0, 0.55)
    this.moon.position.set(-6, 9, -8)
    this.scene.add(this.moon)

    this.emergency = new THREE.PointLight(0x35e6ff, 2.4, 16, 2)
    this.emergency.position.set(-4.2, 2.4, -2.4)
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x9df7ff })
    )
    lamp.position.copy(this.emergency.position)
    this.physical.add(lamp)
    this.lampMesh = lamp

    this.shaftLight = new THREE.SpotLight(0xd7ecff, 55, 30, 0.36, 0.65, 1.4)
    this.shaftLight.position.set(0.8, 9, -5.4)
    this.shaftLight.target.position.set(0.8, 0, -5.6)
    this.scene.add(this.shaftLight, this.shaftLight.target)
  }

  // ── Suelo ──────────────────────────────────────────────────────────────
  _floor() {
    const tex = concreteTexture('floor', [9, 9])
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x6f767f, roughness: 0.96, metalness: 0.02 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    this.physical.add(floor)
    this.floor = floor

    // Escombro fino disperso
    const gritGeo = new THREE.IcosahedronGeometry(0.055, 0)
    const gritMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 1 })
    const grit = new THREE.InstancedMesh(gritGeo, gritMat, 420)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    for (let i = 0; i < 420; i++) {
      p.set(rnd(-11, 11), 0.02, rnd(-13, 2))
      q.setFromEuler(new THREE.Euler(rnd(Math.PI), rnd(Math.PI), rnd(Math.PI)))
      const k = rnd(0.5, 1.6)
      s.set(k, k * 0.6, k)
      m.compose(p, q, s)
      grit.setMatrixAt(i, m)
    }
    this.physical.add(grit)
  }

  // ── Estructura colapsada ──────────────────────────────────────────────
  _structure() {
    const mat = new THREE.MeshStandardMaterial({
      map: concreteTexture(), color: 0xb9c0c9, roughness: 0.94, metalness: 0.03
    })
    this.concreteMat = mat
    const addBox = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      mesh.position.set(x, y, z)
      mesh.rotation.set(rx, ry, rz)
      this.physical.add(mesh)
      return mesh
    }

    // Losa superior partida (cavidad sobre el jugador) con grieta central
    addBox(6.2, 0.5, 9.6, -4.3, 2.35, -6.0, 0.04, 0.02, -0.07)
    addBox(4.6, 0.45, 9.0, 3.7, 2.62, -6.3, -0.03, -0.05, 0.10)
    addBox(5.4, 0.55, 3.6, 0.6, 3.4, -11.6, 0.08, 0.02, 0.02)

    // Muros laterales
    addBox(0.55, 5.2, 14, -8.1, 2.5, -5, 0, 0.05, 0.02)
    addBox(0.55, 5.2, 14, 8.3, 2.7, -5.5, 0, -0.06, -0.03)
    // Muro trasero con boquete por el que entra la luz
    addBox(5.6, 5.6, 0.6, -5.0, 2.6, -13.4, 0, 0.04, 0)
    addBox(4.2, 5.6, 0.6, 5.7, 2.7, -13.6, 0, -0.04, 0)
    addBox(16, 1.7, 0.6, 0.4, 5.6, -13.5, 0, 0, 0.01)

    // Columnas caídas
    const colMat = new THREE.MeshStandardMaterial({ map: concreteTexture('col', [1, 2]), color: 0xa9b1ba, roughness: 0.95 })
    const col1 = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 5.4, 16), colMat)
    col1.position.set(-2.4, 0.34, -6.2)
    col1.rotation.set(0.02, 0.4, Math.PI / 2 - 0.06)
    this.physical.add(col1)
    const col2 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 3.4, 12), colMat)
    col2.position.set(3.3, 0.28, -2.6)
    col2.rotation.set(0, 0.9, Math.PI / 2 + 0.12)
    this.physical.add(col2)

    // Vigas de acero retorcidas
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3d4753, roughness: 0.55, metalness: 0.85 })
    for (let i = 0; i < 7; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, rnd(2.2, 5)), steelMat)
      beam.position.set(rnd(-5, 5), rnd(0.4, 2.1), rnd(-11, -3))
      beam.rotation.set(rnd(-0.9, 0.9), rnd(0, Math.PI), rnd(-0.6, 0.6))
      this.physical.add(beam)
    }

    // Refuerzo expuesto (varillas)
    const rust = new THREE.MeshStandardMaterial({ color: 0x7b4a2c, roughness: 0.8, metalness: 0.6 })
    const rebarGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5)
    const rebars = new THREE.InstancedMesh(rebarGeo, rust, 80)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    for (let i = 0; i < 80; i++) {
      p.set(rnd(-6, 6), rnd(0.1, 1.8), rnd(-11.5, -3.0))
      q.setFromEuler(new THREE.Euler(rnd(-1.4, 1.4), rnd(0, 6.3), rnd(-1.4, 1.4)))
      const len = rnd(0.3, 1.4)
      s.set(1, len, 1)
      m.compose(p, q, s)
      rebars.setMatrixAt(i, m)
    }
    this.physical.add(rebars)
  }

  // ── Escombros instanciados ─────────────────────────────────────────────
  _rubble() {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.97, metalness: 0.02, flatShading: true })
    const COUNT = 340
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    const clusters = [
      { x: 0.9, z: -5.6, r: 3.1, h: 1.35 },
      { x: -3.1, z: -3.2, r: 2.3, h: 1.05 },
      { x: 3.2, z: -8.2, r: 2.7, h: 1.5 },
      { x: -1.8, z: -9.4, r: 2.6, h: 1.2 },
      { x: 5.6, z: -3.8, r: 2.0, h: 0.8 }
    ]
    const col = new THREE.Color()
    for (let i = 0; i < COUNT; i++) {
      const c = clusters[(Math.random() * clusters.length) | 0]
      const a = Math.random() * Math.PI * 2
      const r = Math.pow(Math.random(), 0.65) * c.r
      const t = clamp(1 - r / c.r, 0, 1)
      const k = rnd(0.14, 0.62) * (0.6 + t * 0.9)
      p.set(c.x + Math.cos(a) * r, Math.max(0.03, c.h * Math.pow(t, 1.5) * rnd(0.15, 0.85)), c.z + Math.sin(a) * r)
      q.setFromEuler(new THREE.Euler(rnd(Math.PI), rnd(Math.PI), rnd(Math.PI)))
      s.set(k * rnd(0.7, 1.6), k * rnd(0.5, 1.1), k * rnd(0.7, 1.6))
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
      const v = rnd(0.55, 1.05)
      col.setRGB(v, v * 0.98, v * 0.95)
      mesh.setColorAt(i, col)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.physical.add(mesh)
    this.rubble = mesh
  }

  // ── Polvo en suspensión ────────────────────────────────────────────────
  _dust() {
    const N = 1600
    const pos = new Float32Array(N * 3)
    const vel = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rnd(-11, 11)
      pos[i * 3 + 1] = Math.random() * 4.6 + 0.05
      pos[i * 3 + 2] = rnd(-13, 1.5)
      vel[i * 3] = rnd(-0.05, 0.05)
      vel[i * 3 + 1] = rnd(-0.02, 0.05)
      vel[i * 3 + 2] = rnd(-0.05, 0.05)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      map: dustTexture(), size: 0.055, transparent: true, opacity: 0.26,
      color: 0xd4e3ee, depthWrite: false, sizeAttenuation: true, blending: THREE.NormalBlending
    })
    this.dust = new THREE.Points(geo, mat)
    this.dustVel = vel
    this.physical.add(this.dust)
  }

  // ── Haz de luz por la grieta ───────────────────────────────────────────
  _shaft() {
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xbcd8ef, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.6, 8.6, 26, 1, true), beamMat)
    beam.position.set(0.8, 4.6, -5.4)
    this.scene.add(beam)
    this.beam = beam

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 1.15, 8.6, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    )
    core.position.set(0.8, 4.6, -5.4)
    this.scene.add(core)
    this.beamCore = core

    // "Cielo" visible por la grieta
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 3.4),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xbcd8ef, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    sky.position.set(1.6, 7.6, -9.4)
    sky.rotation.x = 0.5
    this.scene.add(sky)
  }

  // ── Superposición MR / diagnóstico ─────────────────────────────────────
  _mrOverlay() {
    // Polvo "sensorizado": puntos cian que revelan la densidad del aire
    const N = 900
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rnd(-9, 9)
      pos[i * 3 + 1] = Math.random() * 4.4 + 0.1
      pos[i * 3 + 2] = rnd(-12, 1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.sensorDust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x35e6ff, size: 0.035, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, map: dustTexture()
    }))
    this.mrGroup.add(this.sensorDust)

    // Malla del suelo
    const grid = new THREE.GridHelper(46, 46, 0x35e6ff, 0x0d4250)
    grid.material.transparent = true
    grid.material.opacity = 0.16
    grid.position.y = 0.012
    this.mrGroup.add(grid)
    this.grid = grid

    // Contornos estructurales (gemelo digital) en el grupo de diagnóstico
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x35e6ff, transparent: true, opacity: 0.55 })
    this.physical.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'BoxGeometry' && o.geometry.parameters.width > 1.2) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), edgeMat)
        edges.position.copy(o.position)
        edges.rotation.copy(o.rotation)
        edges.scale.copy(o.scale)
        this.diagGroup.add(edges)
      }
    })

    // Anillos de escaneo desde el reloj
    this.scanRings = []
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.98, 1.0, 72),
        new THREE.MeshBasicMaterial({ color: 0x35e6ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.03
      this.diagGroup.add(ring)
      this.scanRings.push({ mesh: ring, t: i / 3 })
    }
  }

  // ── Conmutación de capas de realidad ───────────────────────────────────
  setLayer(i) {
    this.layer = i
    const passthrough = i === 0
    const diag = i === 2
    this.mrGroup.visible = !passthrough
    this.diagGroup.visible = diag
    this.grid.visible = !passthrough
    this.sensorDust.visible = !passthrough
    this.beam.visible = true
    this.hemi.intensity = passthrough ? 1.15 : 0.85
    this.moon.intensity = passthrough ? 0.8 : 0.55
    if (passthrough) {
      this.concreteMat.color.setHex(0xcfd3d8)
      this.scene.fog.color.setHex(0x14181f)
    } else if (diag) {
      this.concreteMat.color.setHex(0x7d858f)
      this.scene.fog.color.setHex(0x040b10)
    } else {
      this.concreteMat.color.setHex(0xb9c0c9)
      this.scene.fog.color.setHex(0x080c14)
    }
  }

  // ── Actualización por frame ────────────────────────────────────────────
  update(dt, game) {
    this.time += dt
    const v = game.vitals
    const q = game.lora ? game.lora.q : 0.5
    const vis = v ? v.visibility : 0.5
    const dustAmt = game.quake ? game.quake.dust : 0

    // Densidad de niebla según visibilidad (ansiedad/polvo) y capa
    const targetDensity = lerp(0.185, 0.038, vis) * (this.layer === 2 ? 1.12 : 1)
    this.scene.fog.density = lerp(this.scene.fog.density, targetDensity, clamp(dt * 1.6, 0, 1))

    // Polvo: deriva + opacidad ligada a la suspensión
    const posAttr = this.dust.geometry.attributes.position
    const arr = posAttr.array
    const boost = 1 + (game.quake ? game.quake.shake * 6 : 0)
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += this.dustVel[i] * dt * boost
      arr[i + 1] += this.dustVel[i + 1] * dt * boost * (0.4 + dustAmt)
      arr[i + 2] += this.dustVel[i + 2] * dt * boost
      if (arr[i + 1] > 5.2) arr[i + 1] = 0.05
      if (arr[i + 1] < 0.02) arr[i + 1] = 0.05
      if (arr[i] > 12) arr[i] = -12
      if (arr[i] < -12) arr[i] = 12
      if (arr[i + 2] > 2) arr[i + 2] = -13.2
      if (arr[i + 2] < -13.5) arr[i + 2] = 1.5
    }
    posAttr.needsUpdate = true
    this.dust.material.opacity = 0.10 + dustAmt * 0.34 + (1 - vis) * 0.10

    // Lámpara de emergencia: parpadea con la calidad del enlace
    const flick = 0.55 + 0.45 * Math.sin(this.time * 13.7) * Math.sin(this.time * 3.1) * 0.4
    this.emergency.intensity = (0.7 + q * 2.2) * (0.75 + flick * 0.35)
    this.lampMesh.material.color.setRGB(0.55 + q * 0.45, 0.9, 1.0)

    // Haz de luz: respira con el entorno; se atenúa con el polvo
    const beamBase = 0.05 * (1 - dustAmt * 0.6) + 0.012 * Math.sin(this.time * 0.9)
    this.beam.material.opacity = beamBase
    this.beamCore.material.opacity = beamBase * 1.4
    this.shaftLight.intensity = 45 + Math.sin(this.time * 0.7) * 6 - dustAmt * 14

    // Anillos de escaneo (solo capa diagnóstico)
    for (const r of this.scanRings) {
      r.t += dt * 0.42
      if (r.t > 1) r.t -= 1
      const s = 0.6 + r.t * 7.5
      r.mesh.scale.set(s, s, s)
      r.mesh.material.opacity = (1 - r.t) * 0.35 * (this.layer === 2 ? 1 : 0)
    }

    // Polvo sensorizado: rotación lenta
    if (this.mrGroup.visible) {
      this.sensorDust.rotation.y += dt * 0.012
      this.sensorDust.material.opacity = 0.22 + q * 0.45 + Math.sin(this.time * 2) * 0.05
    }
    if (this.grid.visible) this.grid.material.opacity = 0.08 + q * 0.16

    // Destello cuando hay réplica sísmica
    if (game.quake && game.quake.shake > 0.2) {
      this.emergency.intensity += game.quake.shake * (Math.random() < 0.3 ? 4 : 0.6)
      this.hemi.intensity = 0.85 + game.quake.shake * 0.35 * Math.random()
    } else {
      this.hemi.intensity = lerp(this.hemi.intensity, this.layer === 0 ? 1.15 : 0.85, clamp(dt * 2, 0, 1))
    }
  }
}
