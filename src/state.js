// ─────────────────────────────────────────────────────────────────────────────
// RESWATCH · state.js — Estado global, bus de eventos y configuración (tuning)
// Este módulo NO depende de DOM ni de three.js: la capa de simulación completa
// (vitals/baro/lora/quake/rescue/pipeline) puede ejecutarse headless en Node.
// ─────────────────────────────────────────────────────────────────────────────

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const rnd = (a = 1, b) => (b === undefined ? (Math.random() * 2 - 1) * a : a + Math.random() * (b - a))
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

// ── Bus de eventos ──────────────────────────────────────────────────────────
const listeners = {}
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); return () => off(ev, fn) }
export function off(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) } }
export function emit(ev, data) { const l = listeners[ev]; if (l) for (const f of l.slice()) f(data) }

// ── Configuración / balance ─────────────────────────────────────────────────
export const CFG = {
  // Ciclo guía de respiración (relajación 4 · 1.5 · 6 · 0.5 ≈ 5 resp/min)
  breathCycle: [
    { name: 'INHALA', dur: 4.0 },
    { name: 'SOSTÉN', dur: 1.5 },
    { name: 'EXHALA', dur: 6.0 },
    { name: 'PAUSA', dur: 0.5 }
  ],

  hr: {
    start: 132,          // bpm justo tras el colapso
    base: 62,            // bpm en reposo
    anxietyGain: 95,     // bpm añadidos con ansiedad = 1
    coherenceGain: 26,   // bpm restados con coherencia = 1
    relax: 0.055,        // velocidad de aproximación al objetivo (1/s)
    redZone: 175,        // zona roja
    fatalZone: 190,      // cuenta doble para el colapso cardíaco
    redZoneFatal: 20     // segundos acumulados en zona roja → derrota
  },

  spo2: {
    start: 94,
    fatal: 55,           // hipoxia letal
    warn: 85,
    baseDecay: 0.030,    // %/s
    depthDecay: 0.030,   // %/s por metro de profundidad
    dustDecay: 0.55,     // %/s con polvo en suspensión al máximo
    panicFactor: 0.004,  // consumo extra por bpm sobre 95
    breathBonus: 0.30,   // oxigenación por respiración coherente (>0.5)
    medicRecover: 0.095, // %/s con dron médico
    supportRecover: 0.05 // %/s con apoyo O₂
  },

  anxiety: {
    start: 0.72,
    decayBase: 0.012,    // decaimiento natural /s
    decayCoherence: 0.11 // decaimiento extra /s por coherencia plena
  },

  coherence: {
    riseMatch: 0.17,     // subida /s sincronizando con la guía
    fallMismatch: 0.30   // caída /s fuera de fase
  },

  baro: {
    surfaceRef: 1012.80, // hPa de referencia en superficie (memorizado pre-colapso)
    startDepth: 3.4,     // metros reales de sepultamiento
    maxDepth: 7.2,
    minDepth: 1.2,
    hPaPerM: 0.12,       // ~12 Pa por metro (escala realista)
    noiseBase: 0.035,
    noiseAnx: 0.22,      // ruido por ansiedad (respiración agitada)
    noiseTremor: 0.38,   // ruido por temblor de muñeca (velocidad del puntero)
    calibThreshold: 0.40 // estabilidad mínima para progresar
  },

  lora: {
    freq: '915 MHz',
    cooldownBase: 3.6,   // s
    cooldownPerSF: 1.7,  // s adicionales por unidad de SF sobre 7
    dispatchAccuracy: 2.5, // m de precisión para despachar rescate
    minDelivered: 3      // paquetes entregados mínimos
  },

  quake: {
    intervalBase: 40,    // s entre réplicas (estado calmado)
    intervalVar: 16,
    panicMul: 0.42,      // multiplicador del intervalo en pánico (¡el peligro escala!)
    panicHr: 150,
    panicAnx: 0.6,
    warnTime: 2.6,       // aviso previo (rumor creciente)
    duration: 3.6,       // duración del sacudón
    anxAdd: 0.22,
    hrAdd: 18,
    spo2Hit: -1.1,       // inhalación de polvo
    depthAdd: [0.12, 0.42], // asentamiento de escombros
    progressHitBase: 3.0
  },

  rescue: {
    flightTime: 11,      // s de vuelo del dron explorador
    scanTime: 5,         // s de escaneo en sitio
    analyzeTime: 4,      // s analizando signos vitales
    contactTime: 7,      // s de cinemática de extracción
    remindInterval: 26,  // s sin paquetes entregados → aviso de señal degradada
    strategies: {
      MEDIC:  { key: 'MEDIC',  name: 'MEDIC-O₂',      base: 2.7, qWeight: 0.65, color: 0x4dff9e,
                desc: 'Dron médico: suministro de O₂ dirigido al superviviente. Prioridad: hipoxia.' },
      CALM:   { key: 'CALM',   name: 'CALM-LINK',     base: 2.8, qWeight: 0.65, color: 0x9d7bff,
                desc: 'Dron de acompañamiento: guía respiratoria aumentada. Prioridad: ansiedad elevada.' },
      HEAVY:  { key: 'HEAVY',  name: 'HEAVY-DRILL',   base: 1.95, qWeight: 0.40, color: 0xffb347,
                desc: 'Perforación asistida por holograma: la profundidad exige equipo pesado.' },
      RAPID:  { key: 'RAPID',  name: 'RAPID-EXTRACT', base: 3.3, qWeight: 0.65, color: 0x35e6ff,
                desc: 'Extracción ligera exprés: signos estables y sepultamiento somero.' }
    }
  },

  visibility: {
    fogMin: 0.040,
    fogMax: 0.185,
    vignetteMax: 0.88
  }
}

// ── Capas de Merged Reality ─────────────────────────────────────────────────
export const LAYERS = [
  { name: 'PASSTHROUGH', label: 'CAPA MR: PASSTHROUGH', desc: 'Solo el entorno físico captado por los sensores' },
  { name: 'MERGED',      label: 'CAPA MR: FUSIÓN',      desc: 'Capas virtuales fusionadas con los escombros' },
  { name: 'DIAG',        label: 'CAPA MR: DIAGNÓSTICO', desc: 'Gemelo digital: escaneo estructural + campo LoRa' }
]

// ── Shell del juego ─────────────────────────────────────────────────────────
export function createGameShell() {
  return {
    mode: 'MENU',            // MENU | PLAY | WINNING | LOSING | END
    paused: false,
    t: 0,                    // reloj de simulación (s)
    layer: 1,                // índice en LAYERS
    watchApp: 'VITAL',       // app activa del reloj (la escribe holograms.js)
    input: { spaceHeld: false, mouseSpeed: 0 },
    stats: null,
    // subsistemas (los asigna pipeline.js / main.js)
    vitals: null, baro: null, lora: null, rescue: null, quake: null,
    env: null, holo: null, audio: null, hud: null
  }
}

export function freshStats() {
  return {
    time: 0, minSpo2: 100, maxHr: 0, coherenceSum: 0, coherenceT: 0,
    coherencePeak: 0, coherenceAbove60: 0, packetsSent: 0, packetsDelivered: 0,
    fixes: 0, finalAccuracy: null, strategy: null, aftershocks: 0,
    result: null, cause: null, score: 0, rating: 'C'
  }
}
