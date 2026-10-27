// ─────────────────────────────────────────────────────────────────────────────
// audio.js — Audio 100% sintetizado con WebAudio (sin archivos).
// Ambiente sísmico, latido sincronizado con el BPM, beeps de radio LoRa,
// alarmas de réplica, cues de respiración y stings de victoria/derrota.
// ─────────────────────────────────────────────────────────────────────────────
export class AudioEngine {
  constructor(game) {
    this.g = game
    this.ctx = null
    this.muted = false
    this.ready = false
    this._t = 0
  }

  init() {
    if (this.ready) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.75
    this.master.connect(this.ctx.destination)

    // Compresor suave para que nada sature
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 20
    comp.ratio.value = 6
    this.master.disconnect()
    this.master.connect(comp)
    comp.connect(this.ctx.destination)

    this._noiseBuffer()
    this._ambient()
    this.ready = true
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume() }

  toggleMute() {
    this.muted = !this.muted
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.75, this.ctx.currentTime, 0.05)
    return this.muted
  }

  _noiseBuffer() {
    const len = this.ctx.sampleRate * 2
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      d[i] = last * 3.5
    }
    this.noiseBuf = buf
  }

  _ambient() {
    const ctx = this.ctx
    // Rumble subterráneo
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 180
    const g = ctx.createGain()
    g.gain.value = 0.16
    src.connect(lp).connect(g).connect(this.master)
    src.start()
    this.rumbleGain = g

    // Drone tonal grave
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 48
    const osc2 = ctx.createOscillator()
    osc2.type = 'triangle'
    osc2.frequency.value = 73.5
    const og = ctx.createGain()
    og.gain.value = 0.035
    osc.connect(og); osc2.connect(og); og.connect(this.master)
    osc.start(); osc2.start()

    // LFO de tensión
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.09
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.03
    lfo.connect(lfoGain).connect(og.gain)
    lfo.start()
    this.droneGain = og
  }

  // ── Primitivas ─────────────────────────────────────────────────────────
  blip(freq = 880, dur = 0.06, vol = 0.06, type = 'square') {
    if (!this.ready || this.muted) return
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(freq * 0.92, t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + dur + 0.02)
  }

  sweep(f0, f1, dur, vol = 0.12, type = 'sine') {
    if (!this.ready || this.muted) return
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + dur + 0.05)
  }

  noise(dur = 1, vol = 0.2, cutoff = 400, type = 'lowpass') {
    if (!this.ready || this.muted) return
    const ctx = this.ctx, t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = cutoff
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t); src.stop(t + dur + 0.05)
  }

  // ── Sonidos del juego ──────────────────────────────────────────────────
  heartbeat(hr) {
    if (!this.ready || this.muted) return
    const vol = 0.10 + Math.min(0.12, Math.max(0, (hr - 60) / 400))
    this.swing(58, 34, 0.13, vol)
  }

  swing(f0, f1, dur, vol) {
    if (!this.ready || this.muted) return
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + dur + 0.03)
  }

  breathIn() { this.sweep(220, 300, 1.1, 0.034, 'sine') }
  breathOut() { this.sweep(300, 190, 1.5, 0.030, 'sine') }
  breathPhase(name) {
    if (name === 'INHALA') this.breathIn()
    else if (name === 'EXHALA') this.breathOut()
  }

  alert() { // alarma de réplica inminente
    this.blip(660, 0.12, 0.09, 'square')
    setTimeout(() => this.blip(520, 0.16, 0.09, 'square'), 180)
  }
  quake() {
    this.noise(2.6, 0.30, 240)
    this.sweep(70, 24, 2.4, 0.16, 'sine')
  }
  radioChirp() { this.blip(1320, 0.06, 0.05); setTimeout(() => this.blip(1760, 0.08, 0.05), 90) }
  rescueArrive() { this.sweep(160, 900, 1.6, 0.10, 'sawtooth'); this.noise(0.7, 0.12, 1600, 'bandpass') }
  fix() { [880, 1100, 1320].forEach((f, i) => setTimeout(() => this.blip(f, 0.07, 0.06, 'triangle'), i * 70)) }
  medDrop() { this.sweep(500, 900, 0.6, 0.06, 'sine'); setTimeout(() => this.sweep(900, 400, 0.9, 0.05, 'sine'), 400) }
  calmTone() { this.swing(196, 196, 2.4, 0.05) }

  win() {
    const notes = [523, 659, 784, 1046]
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.5, 0.10, 'triangle'), i * 160))
    this.sweep(120, 240, 2.4, 0.08, 'sine')
  }
  lose() {
    this.sweep(320, 40, 2.0, 0.20, 'sawtooth')
    this.noise(1.6, 0.2, 320)
    setTimeout(() => this.swing(60, 30, 2.2, 0.14), 500)
  }

  // ── Mezcla continua (llamada cada frame) ───────────────────────────────
  update(dt, game) {
    if (!this.ready) return
    const q = game.lora ? game.lora.q : 0.5
    const anxiety = game.vitals ? game.vitals.anxiety : 0.3
    const shake = game.quake ? game.quake.shake : 0
    const t = this.ctx.currentTime
    if (this.rumbleGain) this.rumbleGain.gain.setTargetAtTime(0.10 + shake * 0.55 + anxiety * 0.10, t, 0.12)
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0.014 + (1 - q) * 0.05 + anxiety * 0.02, t, 0.6)
    }
  }
}
