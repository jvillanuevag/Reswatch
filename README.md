# RESWATCH — Merged Reality: Protocolo de Rescate

[![Desplegar RESWATCH en GitHub Pages](https://github.com/jvillanuevag/Reswatch/actions/workflows/deploy.yml/badge.svg)](https://github.com/jvillanuevag/Reswatch/actions/workflows/deploy.yml)
[![Sitio en vivo](https://img.shields.io/badge/jugar-en%20vivo-35e6ff)](https://jvillanuevag.github.io/Reswatch/)

**▶ Jugar ahora: <https://jvillanuevag.github.io/Reswatch/>**

Simulador interactivo de **Realidad Mixta / Merged Reality** en el navegador. El terremoto ha
derribado el edificio: estás sepultado bajo los escombros y lo único que te conecta con el mundo es
el **RESWATCH**, un reloj de emergencia con sensores biométricos (pulso y oxígeno), barómetro y
radio **LoRa**. Su visor proyecta una capa virtual de escombros sobre el entorno y convierte tu
cuerpo en el mando del juego.

> **Regla central:** el pánico apaga la señal. La calma la enciende. Los drones y equipos de socorro
> holográficos leen tu reporte biométrico en tiempo real, triangulan tu posición por LoRa y adaptan
> la estrategia de rescate a tus signos vitales.

---

## ▶ Cómo ejecutarlo

```bash
npm install
npm run dev        # http://localhost:5173  (servidor accesible en 0.0.0.0)
npm run build      # producción en dist/
npm run preview    # sirve dist/
npm test           # simulación headless + smoke test de la capa de presentación
```

Requisitos: Node 18+ y un navegador con **WebGL2** (Chrome/Edge/Firefox/Safari recientes).
Sin dependencias de red en tiempo de ejecución: toda la geometría, texturas y audio se generan
por procedimiento en tu equipo.

---

## 🎮 Controles

| Entrada | Acción |
| --- | --- |
| **ESPACIO** (mantener) | Inhala al mantener, exhala al soltar. Sigue el anillo guía. |
| **Arrastrar sobre el reloj** / **rueda** | Girar el bisel 3D y cambiar de app: `VITAL → BARO → LORA → SOS`. |
| **Clic en la pantalla del reloj** | Con la app **SOS** activa, transmite un paquete LoRa. |
| **T** | Atajo de emergencia: activa SOS y transmite. |
| **1 · 2 · 3 · 4** | Ir directo a cada app del reloj. |
| **Arrastrar fuera del reloj** | Mirar alrededor del visor (yaw/pitch limitados). |
| **L** | Ciclar capas MR: `PASSTHROUGH → FUSIÓN → DIAGNÓSTICO`. |
| **M** / **P** / **R** | Silenciar audio / pausa / reiniciar (en la pantalla final). |
| **Mantener pulsado el anillo** (móvil) | Equivalente táctil de ESPACIO. |

Consejo: mantener pulsado es una **inhalación**; soltar es una **exhalación**. El anillo se expande
en la inhalación (4 s), sostiene (1.5 s), se contrae en la exhalación (6 s) y hace una pausa breve.
Sincronizar es lo que sube la **coherencia**.

---

## 🧠 Bucle de juego

1. **Sobrevivir.** La ansiedad nace al 72 %. Tu pulso electrocutado (132 bpm) y tu SpO₂ (94 %) caen
   en picado. Respira con la guía para bajar el pulso, subir la coherencia y oxigenarte.
2. **Calibrar el barómetro.** Gira el bisel hasta la app **BARO** y mantén el pulso firme: el
   temblor de muñeca y el jadeo inyectan ruido en el sensor MEMS. Con la lectura estable, el reloj
   fija la referencia de superficie y la **profundidad de sepultamiento** pasa a ser fiable.
3. **Transmitir.** En **SOS**, cada paquete LoRa porta tu reporte biométrico `{HR, SpO₂, profundidad}`.
   Con buena calidad de enlace llega a los 3 gateways; con 3 receptores simultáneos se produce la
   **fijación de posición** y la precisión de la retícula colapsa hacia ±2.5 m.
4. **Esperar y resistir.** Se despacha el dron explorador, escanea la cavidad, interpreta tus signos
   vitales y **elige estrategia**:
   - **MEDIC-O₂** — hipoxia (SpO₂ baja): cápsula de oxígeno dirigida.
   - **CALM-LINK** — pulso/ansiedad altos: acompañamiento respiratorio (suelo de coherencia).
   - **HEAVY-DRILL** — sepultamiento profundo (≥ 4.2 m): perforación asistida.
   - **RAPID-EXTRACT** — estable y somero: extracción ligera.
5. **Extracción.** El progreso depende de la calidad LoRa y de tu estabilidad: si el pulso se dispara
   o la señal cae, el túnel de luz se frena e incluso retrocede con cada réplica.

**Derrota:** SpO₂ ≤ 55 % (hipoxia) o 20 s acumulados con el pulso en zona roja (≥ 175 bpm).
**Victoria:** completar el 100 % de extracción y el contacto.

---

## 📊 Sensores simulados → consecuencias jugables

| Sensor / señal | Modelo | Consecuencia en el juego |
| --- | --- | --- |
| **Pulso** (HR) | Objetivo `62 + ansiedad·95 − coherencia·26 + profundidad·1.15`, con relajación exponencial y ruido | Visión de túnel (FOV), pulso rojo en pantalla, zona roja acumulativa, ECG y latido de audio |
| **SpO₂** | Decae por profundidad, polvo y taquicardia; **sube al respirar con coherencia**; se recupera con O₂ del dron | Tinte de hipoxia, muerte por hipoxia, dispara la estrategia MEDIC |
| **Ansiedad** | Sube con réplicas, polvo y taquicardia; baja con coherencia y con el dron CALM | **Niebla y viñeta** (visibilidad), frecuencia de réplicas, ruido del barómetro |
| **Coherencia (HRV)** | Sube sincronizando con la guía; cae fuera de fase (más si hiperventilas) | Calidad LoRa, oxigenación, progreso de rescate, estabilidad de los anillos RF |
| **Barómetro** | `profundidad = (P − P₀ref) / 0.12 hPa/m`, con error de referencia y ruido por temblor/ansiedad | Profundidad real del reporte, Spreading Factor LoRa, elección de estrategia |
| **LoRa** | Calidad `q ≈ coherencia·0.5 + (1−ansiedad)·0.3 + calibración·0.2`; SF por profundidad; entrega estocástica y triangulación por gateways | Alcance de los paquetes, precisión de la retícula, despacho del rescate, ritmo de extracción |
| **Réplicas sísmicas** | Intervalo base 40 s; **×0.42 si hay pánico**; más polvo y asentamiento de escombros | Sacudida de cámara, polvo (visibilidad y SpO₂), pérdida de progreso, interferencia RF |

La **visibilidad** final combina ansiedad, polvo y coherencia: `1 − ansiedad·0.85 − polvo·0.75 +
coherencia·0.12`. Se aplica a niebla volumétrica, viñeta, FOV y contraste de la lámpara de emergencia.

---

## 🚀 Despliegue (GitHub Pages)

El sitio se publica automáticamente en **<https://jvillanuevag.github.io/Reswatch/>** con el
workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

**Disparadores:** cada push a `main` y ejecuciones manuales (`workflow_dispatch`).
**Secuencia:** `npm ci` → `npm test` (simulación + presentación) → `npm run build` → verificación del
artefacto → publicación → comprobación del sitio en vivo.

La compilación usa `base: './'` en `vite.config.js`, por lo que todos los assets se resuelven de forma
relativa y el subpath `/Reswatch/` funciona sin configuración extra. El despliegue está aislado en el
environment `github-pages` con permisos mínimos (`contents: read`, `pages: write`, `id-token: write`).

Requisitos de una sola vez en el repositorio: **Settings → Pages → Source: GitHub Actions**.
Sin pasos manuales de build ni rama `gh-pages`.

Para servir la compilación localmente tal como queda publicada:

```bash
npm run build && npm run preview     # http://localhost:4173
```

## 🧩 Capas de Merged Reality

| Capa | Qué añade |
| --- | --- |
| **PASSTHROUGH** | Solo el mundo físico captado por el visor, más luz y menos saturación. |
| **FUSIÓN** | Capas virtuales sobre los escombros: gateways, baliza, retícula, túnel de extracción, reloj holográfico. |
| **DIAGNÓSTICO** | Gemelo digital: contornos estructurales, rejilla, nubes de puntos, anillos de escaneo desde el reloj. |

La escena es procedural: concreto con grietas, losa partida, escombros instanciados, varillas,
polvo en suspensión, haz de luz por la grieta y skyline colapsado.

---

## 🗂️ Arquitectura

```
index.html               HUD y pantallas (DOM)
src/
  main.js                bootstrap WebGL, bucle, cámara del visor, entrada, flujo de pantallas
  state.js               configuración/balance (CFG), bus de eventos, shell del juego
  style.css              interfaz holográfica y responsive
  sim/                   ── capa pura, sin DOM ni three (testeable en Node)
    vitals.js            pulso, SpO₂, ansiedad, coherencia, guía respiratoria, ECG
    baro.js              barómetro MEMS: ruido, calibración, profundidad
    lora.js              enlace LoRa: calidad, SF/RSSI/SNR, paquetes, triangulación
    quake.js             réplicas: peligro dinámico según el pánico
    rescue.js            fases del rescate, elección de estrategia, progreso
    pipeline.js          ensamblado, objetivos, estadísticas y puntuación
  mr/                    ── presentación 3D
    environment.js       escena del colapso y capas MR
    watch.js             reloj 3D, bisel, pantalla canvas, holograma ECG, anillos RF
    holograms.js         gateways, drones por estrategia, retícula, túnel, etiquetas AR
    util.js              texturas y etiquetas procedurales
  ui/hud.js              telemetría, ECG, respiración, registro de radio, informes
  audio.js               WebAudio: ambiente, latidos, radio, alarmas, stings
scripts/
  simtest.mjs            3 escenarios (sereno / pánico / sin transmisión) con aserciones
  domtest.mjs            jsdom + three: construye HUD/reloj/escena y ejecuta 210 s de frames
docs/DISENO.md           diseño detallado, fórmulas, máquina de estados y hoja de ruta
```

La simulación **no** depende de three.js ni del DOM: puede ejecutarse en Node (pruebas) o
reutilizarse para otro cliente (WebXR, versión móvil nativa, servidor autoritativo).

---

## ✅ Pruebas

```bash
npm test
```

- `simtest.mjs` ejecuta la pipeline real con tres políticas de jugador:
  - **A · sereno**: gana en ~2 min, conserva SpO₂, fija posición ≤ 2.5 m, recibe estrategia.
  - **B · pánico**: pierde por hipoxia o colapso antes del rescate y sufre ~2.5× más réplicas/min.
  - **C · calma sin transmitir**: no hay rescate (el protocolo nunca se activa).
- En CI, ambos tests se ejecutan **antes** de cualquier despliegue: si fallan, el sitio no se publica.
- `domtest.mjs` monta el `index.html` real en jsdom, construye `Environment`, `Watch`, `Holograms`
  y `Hud`, y simula 210 s de frames comprobando que no hay excepciones y que el HUD refleja la
  telemetría.

---

## ⚠️ Alcance y honestidad técnica

- Los **signos vitales son simulados** (modelo fisiológico simplificado). No se accede a la cámara,
  al micrófono ni a sensores reales; el visor MR se recrea con capas 3D y efectos de pantalla.
- El audio es sintetizado; no hay archivos de voz.
- El juego es una pieza de **diseño especulativo**: no sustituye protocolos reales de búsqueda y
  rescate. Las cifras de LoRa/barometría están inspiradas en el comportamiento real (SF7–SF12,
  ~12 Pa por metro), comprimidas por legibilidad jugable.
- Para llevarlo a hardware real, ver la hoja de ruta en [`docs/DISENO.md`](docs/DISENO.md):
  Web Bluetooth (bandas HR), Sensor APIs (barómetro del móvil), WebXR para el visor y un gateway
  LoRa real vía WebSocket.
