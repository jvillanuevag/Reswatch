// ─────────────────────────────────────────────────────────────────────────────
// hud.js — HUD holográfico: telemetría, ECG, guía de respiración, registro de
// radio y pantallas de menú/final. Todo el estado viene de la simulación.
// ─────────────────────────────────────────────────────────────────────────────
import { CFG, LAYERS, clamp, on, off } from '../state.js'
import { OBJECTIVES } from '../sim/pipeline.js'

const $ = (id) => document.getElementById(id)

export class Hud {
  constructor(game, actions) {
    this.g = game
    this.actions = actions
    this.el = {
      hud: $('hud'), menu: $('menu-screen'), endscreen: $('end-screen'),
      objective: $('objective'), hint: $('hint'), timer: $('timer'),
      hr: $('hr-val'), spo2: $('spo2-val'), spo2Fill: $('spo2-fill'),
      coh: $('coh-val'), cohFill: $('coherence-fill'),
      anxFill: $('anx-fill'), respVal: $('resp-val'),
      baroHpa: $('baro-hpa'), baroDepth: $('baro-depth'), calibFill: $('calib-fill'), calibState: $('calib-state'),
      sigFill: $('sig-fill'), loraSf: $('lora-sf'), loraSnr: $('lora-snr'), pktInfo: $('pkt-info'), acc: $('acc-val'),
      txCd: $('tx-cooldown'), txLabel: $('tx-label'),
      rescuePhase: $('rescue-phase'), triState: $('tri-state'), rescueProg: $('rescue-prog-fill'),
      rescueProgVal: $('rescue-prog-val'), strategy: $('rescue-strategy'),
      log: $('log'), toast: $('toast'),
      breathRing: $('breath-ring'), breathPhase: $('breath-phase'),
      vignette: $('vignette'), redpulse: $('redpulse'), hypoxia: $('hypoxia'), whiteness: $('whiteness'),
      pause: $('pause-overlay'), pauseBtn: $('pause-btn'), layerBtn: $('layer-btn'), muteBtn: $('mute-btn'),
      vitalsPanel: $('vitals-panel'), envPanel: $('env-panel'), rescuePanel: $('rescue-panel'),
      endTitle: $('end-title'), endSub: $('end-sub'), endStats: $('end-stats'), endRating: $('end-rating'),
      endRatingLabel: $('end-rating-label')
    }
    this.breathCore = $('breath-core')
    this.breathBtn = $('breath-btn')
    this.ecg = $('ecg')
    this.ecgCtx = this.ecg.getContext('2d')
    this.ecgW = this.ecg.width
    this.ecgH = this.ecg.height
    this.ecgBuf = new Float32Array(this.ecgW).fill(0)
    this.panelAcc = 0
    this.toastTimer = null
    this.logEntries = []
    this.lastLayer = -1

    const tap = (el, fn) => el.addEventListener('click', (e) => { e.currentTarget.blur?.(); fn() })
    tap(this.el.layerBtn, () => actions.cycleLayer())
    tap(this.el.muteBtn, () => actions.toggleMute())
    tap(this.el.pauseBtn, () => actions.togglePause())
    tap($('start-btn'), () => actions.start())
    tap($('restart-btn'), () => actions.restart())
    on('radio', ({ text, kind, t }) => this.addLog(text, kind, t))
    on('objective', ({ text }) => {
      if (text) this.setObjective(text)
    })
    on('fix', () => this.toast('TRIANGULACIÓN FIJADA · precisión mejorada'))
    on('calibrated', () => this.toast('BARÓMETRO CALIBRADO · profundidad fiable'))
    on('aftershock-warn', () => this.toast('⚠ RÉPLICA INMINENTE — respira profundo', true))
    on('strategy', ({ strategy }) => this.toast(`ESTRATEGIA DE RESCATE: ${strategy.name}`))
    on('win', () => this.flashWhite())
    on('tx-blocked', ({ remain }) => this.toast(`PAQUETE EN VUELO · recarga ${remain.toFixed(1)} s`, true))
    this.addLog('RESWATCH iniciado. Buscando señal de emergencia…', 'sys', 0)
  }

  // ── Pantallas ──────────────────────────────────────────────────────────
  showMenu() { this.el.menu.classList.remove('hidden'); this.el.hud.classList.add('hidden'); this.el.endscreen.classList.add('hidden') }
  beginPlay() {
    this.el.menu.classList.add('hidden')
    this.el.hud.classList.remove('hidden')
    this.el.endscreen.classList.add('hidden')
    this.el.log.innerHTML = ''
    this.logEntries = []
    this.setObjective(OBJECTIVES[0].text)
    this.el.hint.textContent = OBJECTIVES[0].hint
    this.el.whiteness.style.opacity = '0'
    this.toast('MANTÉN ESPACIO AL INHALAR · SUELTA AL EXHALAR')
  }
  setObjective(text) {
    this.el.hint.textContent = text
    this.el.objective.textContent = 'OBJETIVO'
    this.toast(text)
  }
  setPaused(p) {
    this.el.pause.classList.toggle('hidden', !p)
    this.el.pauseBtn.textContent = p ? 'CONTINUAR (P)' : 'PAUSA (P)'
  }
  flashWhite() {
    this.el.whiteness.style.opacity = '0.55'
    setTimeout(() => { this.el.whiteness.style.opacity = '0' }, 380)
  }
  toast(msg, warn = false) {
    const t = this.el.toast
    t.textContent = msg
    t.classList.toggle('warn', !!warn)
    t.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3400)
  }

  addLog(text, kind = 'sys', t = this.g.t) {
    const now = typeof t === 'number' ? t : this.g.t
    const mm = String(Math.floor(now / 60)).padStart(2, '0')
    const ss = String(Math.floor(now % 60)).padStart(2, '0')
    const item = document.createElement('div')
    item.className = `log-item ${kind}`
    item.innerHTML = `<span class="lt">${mm}:${ss}</span>${this._esc(text)}`
    this.el.log.prepend(item)
    this.logEntries.push(item)
    while (this.logEntries.length > 4) {
      const old = this.logEntries.shift()
      old.remove()
    }
  }
  _esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }

  // ── Frame ──────────────────────────────────────────────────────────────
  update(dt, game) {
    if (game.mode === 'MENU') return
    this._updateEcg(dt, game)
    this._updateBreath(game)
    this._updateFx(game)
    this.panelAcc += dt
    if (this.panelAcc > 0.08) { this.panelAcc = 0; this._updatePanels(game) }
    if (game.layer !== this.lastLayer) {
      this.lastLayer = game.layer
      this.el.layerBtn.textContent = LAYERS[game.layer].label
      this.el.layerBtn.title = LAYERS[game.layer].desc
    }
  }

  _updateEcg(dt, game) {
    const v = game.vitals
    if (!v) return
    // desplazar buffer y añadir la muestra actual
    this.ecgBuf.copyWithin(0, 1)
    this.ecgBuf[this.ecgW - 1] = v.ecgAt(v.beatPhase)

    const ctx = this.ecgCtx
    const W = this.ecgW, H = this.ecgH
    ctx.clearRect(0, 0, W, H)
    // rejilla
    ctx.strokeStyle = 'rgba(53,230,255,0.09)'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 13) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    // traza
    const color = v.hr > 170 ? '#ff3b5c' : v.hr > 130 ? '#ffb347' : '#4dff9e'
    ctx.beginPath()
    for (let i = 0; i < W; i++) {
      const y = H / 2 - this.ecgBuf[i] * (H * 0.62)
      if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6
    ctx.shadowColor = color
    ctx.shadowBlur = 6
    ctx.stroke()
    ctx.shadowBlur = 0
    // cursor
    ctx.fillStyle = color
    ctx.fillRect(W - 2, 0, 2, H)
  }

  _updateBreath(game) {
    const v = game.vitals
    if (!v) return
    const ring = this.el.breathRing
    const s = 0.55 + v.guide.ring * 0.75
    ring.style.transform = `scale(${s.toFixed(3)})`
    const core = this.breathCore
    core.style.transform = `scale(${(0.7 + v.guide.ring * 0.5).toFixed(2)})`
    const held = game.input.spaceHeld
    const matched = held === v.shouldHold
    ring.classList.toggle('sync', matched && v.coherence > 0.35)
    ring.classList.toggle('mismatch', !matched)
    const ph = CFG.breathCycle[v.guide.phase]
    const remain = Math.max(0, ph.dur - v.guide.t)
    this.el.breathPhase.textContent = `${v.phaseName} ${remain.toFixed(1)}s`
    if (!game.vitals.death && game.mode === 'PLAY') {
      const holdHint = v.shouldHold ? 'MANTÉN ESPACIO' : 'SUELTA ESPACIO'
      this.breathBtn.innerHTML = `${holdHint} <span class="touch">(o mantén pulsado)</span>`
    }
  }

  _updateFx(game) {
    const v = game.vitals
    if (!v) return
    const vis = v.visibility
    this.el.vignette.style.opacity = (0.32 + (1 - vis) * 0.62).toFixed(3)
    const panic = clamp((v.hr - 120) / 70 + v.anxiety * 0.7, 0, 1.4)
    const beat = Math.exp(-Math.pow((v.beatPhase - 0.31) / 0.06, 2))
    this.el.redpulse.style.opacity = (panic * (0.35 + beat * 0.65) * 0.75).toFixed(3)
    const hyp = v.spo2 < 88 ? (88 - v.spo2) / 33 : 0
    this.el.hypoxia.style.opacity = clamp(hyp * 0.75 + (game.vitals.death === 'HIPOXIA' ? 0.3 : 0), 0, 0.85).toFixed(3)
    if (game.mode === 'END' || game.mode === 'LOSING') {
      this.el.whiteness.style.opacity = '0'
    }
  }

  _updatePanels(game) {
    const v = game.vitals, b = game.baro, l = game.lora, r = game.rescue
    if (!v || !b || !l || !r) return
    // Vitals
    this.el.hr.textContent = Math.round(v.hr)
    this.el.hr.style.color = v.hr > 175 ? '#ff3b5c' : v.hr > 140 ? '#ffb347' : '#4dff9e'
    this.el.spo2.textContent = `${v.spo2.toFixed(0)}%`
    this.el.spo2Fill.style.width = `${clamp((v.spo2 - 70) / 30 * 100, 0, 100)}%`
    this.el.spo2Fill.style.background = v.spo2 < 85 ? 'linear-gradient(90deg,#8a1e2c,#ff3b5c)' : ''
    this.el.coh.textContent = `${(v.coherence * 100).toFixed(0)}%`
    this.el.cohFill.style.width = `${v.coherence * 100}%`
    this.el.anxFill.style.width = `${(v.anxiety * 100).toFixed(0)}%`
    this.el.respVal.textContent = `${v.respRate.toFixed(0)} rpm`

    // Barómetro
    this.el.baroHpa.textContent = `${b.smooth.toFixed(2)} hPa`
    this.el.baroDepth.textContent = `${b.measuredDepth.toFixed(1)} m`
    this.el.baroDepth.style.color = b.calibrated ? '#cfe9f2' : '#ffb347'
    this.el.calibFill.style.width = `${(b.calibProgress * 100).toFixed(0)}%`
    this.el.calibState.textContent = b.calibrated ? 'CALIBRADO · REFERENCIA FIJA' : `SIN CALIBRAR · ${(b.calibProgress * 100).toFixed(0)}%`
    this.el.calibState.classList.toggle('ok', b.calibrated)

    // LoRa
    this.el.sigFill.style.width = `${(l.q * 100).toFixed(0)}%`
    this.el.loraSf.textContent = `SF${l.sf} · ${l.rssi.toFixed(0)} dBm`
    this.el.loraSnr.textContent = `${l.snr.toFixed(1)} dB`
    this.el.pktInfo.textContent = `${l.packets.sent} TX · ${l.packets.delivered} OK`
    this.el.acc.textContent = l.accuracy >= 40 ? 'SIN FIJACIÓN' : `± ${l.accuracy.toFixed(1)} m`
    this.el.acc.style.color = l.accuracy <= CFG.lora.dispatchAccuracy ? '#4dff9e' : l.accuracy < 12 ? '#ffb347' : '#cfe9f2'
    const ready = l.cooldown <= 0
    this.el.txCd.style.transform = `scaleX(${ready ? 1 : 1 - l.cooldownFrac})`
    this.el.txLabel.textContent = ready ? 'LISTO PARA TX (T)' : `CARGANDO PAQUETE · ${l.cooldown.toFixed(1)} s`
    this.el.txLabel.classList.toggle('ready', ready)

    // Rescate
    this.el.rescuePhase.textContent = r.phase
    this.el.triState.textContent = `Triangulación: ${l.packets.fixes} fijaciones · ${l.packets.delivered}/${l.packets.sent} paquetes entregados`
    this.el.rescueProg.style.width = `${r.progress.toFixed(0)}%`
    this.el.rescueProgVal.textContent = `${r.progress.toFixed(0)}%`
    this.el.strategy.textContent = r.strategyDef
      ? `Estrategia: ${r.strategyDef.name} — ${r.strategyDef.desc}`
      : 'Estrategia: a la espera de datos biométricos…'

    // Temporizador
    const t = Math.max(0, Math.floor(game.t))
    this.el.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }

  // ── Informe final ──────────────────────────────────────────────────────
  showEnd(game) {
    const s = game.stats
    const win = s.result === 'WIN'
    this.el.endTitle.textContent = win ? 'RESCATE COMPLETADO' : 'SEÑAL PERDIDA'
    this.el.endTitle.classList.toggle('lose', !win)
    this.el.endSub.textContent = win
      ? `El equipo ${s.strategy ? s.strategy : ''} te ha extraído con vida.`
      : s.cause === 'HIPOXIA'
        ? 'Hipoxia terminal: la señal biométrica se apagó antes de la extracción.'
        : 'Colapso cardiovascular: el pulso sostenido en zona roja fue letal.'
    this.el.endRating.textContent = s.rating
    this.el.endRating.classList.toggle('c', s.rating === 'C')
    this.el.endRatingLabel.textContent = win ? 'RANGO OPERADOR' : 'SEÑAL PERDIDA'
    const cohAvg = s.coherenceT > 0 ? s.coherenceSum / s.coherenceT : 0
    const cells = [
      ['TIEMPO', `${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`, ''],
      ['SpO₂ MÍNIMO', s.minSpo2.toFixed(1), '%'],
      ['PULSO MÁXIMO', Math.round(s.maxHr), 'bpm'],
      ['COHERENCIA MEDIA', `${(cohAvg * 100).toFixed(0)}%`, ''],
      ['PAQUETES LoRa', `${s.packetsDelivered}/${s.packetsSent}`, 'entregados'],
      ['PRECISIÓN FINAL', s.finalAccuracy < 40 ? `±${s.finalAccuracy.toFixed(1)}` : 's/fijación', 'm'],
      ['RÉPLICAS', s.aftershocks, ''],
      ['ESTRATEGIA', s.strategy ?? '—', ''],
      ['PUNTUACIÓN', s.score, 'pts']
    ]
    this.el.endStats.innerHTML = cells.map(([k, v, u]) =>
      `<div class="stat-cell"><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ''}</div></div>`).join('')
    this.el.endscreen.classList.remove('hidden')
    this.el.hud.classList.add('hidden')
  }
}
