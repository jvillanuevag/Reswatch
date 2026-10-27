# RESWATCH · Documento de diseño

> Juego interactivo de **Realidad Mixta / Merged Reality** centrado en un reloj de emergencias.
> El jugador está sepultado tras un terremoto; su cuerpo y su capacidad de respirar son el mando.

---

## 1. Pilares

1. **El cuerpo manda.** Nada se resuelve con reflejos: se resuelve con respiración, pulso y calma.
   El pánico es la única mecánica de "daño" real.
2. **El reloj es el interfaz.** Manipular el dispositivo con pulso firme (bisel, apps, calibración)
   tiene consecuencias físicas simuladas (ruido barométrico, paquetes, coherencia).
3. **La fusión es información.** Las capas MR no son decoración: gateways, retícula, túnel y
   etiquetas muestran los datos que el rescate holográfico usa para decidir.
4. **El rescate es un sistema, no un temporizador.** Los drones interpretan el reporte biométrico y
   **adaptan** la estrategia; el jugador puede influir en esa decisión.

---

## 2. Del encargo al sistema

| Requisito del encargo | Implementación |
| --- | --- |
| Dispositivo 3D con sensores biométricos (pulso y oxígeno) | `Watch` 3D manipulable + `Vitals` (HR, SpO₂, ansiedad, coherencia, ECG) |
| Barómetro | `Baro`: presión MEMS → profundidad, con calibración y ruido por temblor |
| Comunicación LoRa | `Lora`: calidad, SF, RSSI, SNR, paquetes, 3 gateways, triangulación |
| El entorno físico se vuelve escenario de colapso | `Environment`: cavidad, losa partida, escombros instanciados, polvo, haz de luz |
| Capas virtuales de escombros | Tres capas MR: Passthrough / Fusión / Diagnóstico (malla, contornos, puntos) |
| Si el pulso o la ansiedad se elevan, la visibilidad disminuye | `visibility = 1 − ansiedad·0.85 − polvo·0.75 + coherencia·0.12` → niebla, viñeta, FOV, túnel visual |
| La simulación intensifica el peligro | `Quake`: intervalo ×0.42 en pánico, más polvo, más interferencia RF, progreso de rescate retrocede |
| Respiración calmada estabiliza la señal RF holográfica | `q ≈ coherencia·0.5 + (1−ansiedad)·0.3 + calibración·0.2`; anillos RF del reloj vibran/parpadean con `q` |
| El barómetro calcula la profundidad de sepultamiento | `depth = (P − P₀ref) / 0.12 hPa/m`, con error de referencia hasta calibrar |
| Drones y equipos holográficos interpretan el reporte en tiempo real | Fase `ANALYZING` + log de radio con HR/SpO₂/profundidad + dron con forma y color por estrategia |
| Triangulación con LoRa | Cada paquete entrega a 0–3 gateways; 3 receptores ⇒ fijación y precisión `≤ 2.5 m` |
| Estrategia de rescate adaptada a los signos vitales | `MEDIC` (hipoxia) / `CALM` (pánico) / `HEAVY` (profundidad ≥ 4.2 m) / `RAPID` (estable) |

---

## 3. Modelo fisiológico (simulado)

```
objetivoHR = 62 + ansiedad·95 − coherencia·26 + max(0, profundidad − 2)·1.15
HR ← HR + (objetivoHR − HR)·dt·0.055 + ruido(ansiedad)

dSpO₂/dt = −[0.030 + 0.030·profundidad + 0.55·polvo]·(1 + max(0,HR−95)·0.004)
           + respiración   (si coherencia > 0.5 → +(coherencia−0.5)·0.30)
           + dron O₂       (MEDIC: +0.095 / apoyo: +0.05, con decaimiento reducido)

dAnsiedad/dt = −0.012 − coherencia·0.11 + max(0,HR−135)·0.0016
               + polvo·0.05 + aviso_de_réplica·0.035 + hipoxia·0.02 − rescate_en_curso·0.02

coherencia:  +0.17/s en fase correcta · −0.30/s fuera de fase (−0.375/s si pulsas al exhalar)
zonaRoja:   +1/s con HR ≥ 175 (+2/s con HR ≥ 190); se enfría a 0.7/s → 20 s acumulados = colapso
```

Consecuencia: sin respirar no se sube la coherencia; sin coherencia no se oxigena, no sube la señal
RF y el rescate no avanza. Todo el sistema depende de una sola acción del jugador.

---

## 4. Barómetro y manipulación del reloj

- Referencia de superficie memorizada antes del colapso: **1012.80 hPa**.
- Escala: **0.12 hPa/m** (≈ 12 Pa/m, orden de magnitud real).
- Sin calibrar, la referencia arrastra un error de ±0.9–2 m aparentes.
- Ruido de lectura: `0.035 + ansiedad·0.22 + temblor·0.38` hPa, donde *temblor* es la velocidad del
  puntero sobre el reloj. Manipular el bisel con calma **mejora** la lectura; hacerlo con prisa la
  arruina.
- Calibración: app BARO abierta + estabilidad > 0.40 ⇒ progreso; 100 % en ~12–20 s si estás calmado.

---

## 5. LoRa y triangulación

- Banda mostrada: 915 MHz (ISM). El **Spreading Factor** se deriva de la profundidad
  (`<1 m → SF8 … ≥5.5 m → SF12`) y controla el *airtime* y el cooldown del reloj (3.6 s + 1.7 s/SF).
- Probabilidad de entrega `0.12 + q·0.86 − max(0, profundidad−3)·0.03`; receptores por gateway
  `0.30 + q·0.62`.
- Con **3 gateways** simultáneos: fijación de posición y `precisión ← precisión·(1.08 − q·0.68)`.
  Partiendo de 45 m se converge a ±2.5 m en ~4 fijaciones de alta calidad.
- Cada paquete lleva el reporte: `{HR, SpO₂, profundidad, SF, RSSI, SNR}`.

---

## 6. Rescate: máquina de estados

```
IDLE ──paquete──► ALERTED ──≥2 paquetes──► TRIANG ──3 GW + ≤2.5 m──► DISPATCHED
   (11 s de vuelo)──► ONSITE (escaneo 5 s)──► ANALYZING (4 s)
   ──► EXECUTING [estrategia según signos vitales] ──► CONTACT (7 s) ──► DONE (victoria)
```

- **Estrategias** (velocidad base y peso de calidad de señal):

  | Estrategia | Base | Peso q | Sesgo |
  | --- | --- | --- | --- |
  | MEDIC-O₂ | 2.70 %/s | 0.65 | SpO₂ < 86, o < 90 con tendencia negativa y taquicardia |
  | CALM-LINK | 2.80 %/s | 0.65 | ansiedad > 0.55 o HR > 125 |
  | HEAVY-DRILL | 1.95 %/s | 0.40 | profundidad medida ≥ 4.2 m |
  | RAPID-EXTRACT | 3.30 %/s | 0.65 | estable y somero (penaliza si HR > 140) |

- El progreso multiplica `base · (1 − qWeight + qWeight·q) · factor_vitales`; una réplica resta
  3–9 puntos y bloquea parcialmente la ruta.
- Avisos de radio cada 26 s si el equipo deja de recibir telemetría: recordatorio de transmitir.

---

## 7. Peligro dinámico

- Réplicas cada `40 ± 16 s`; ese intervalo se **divide por 0.42** mientras `HR > 150` o
  `ansiedad > 0.6` (≈ 2.5× más frecuentes, medido en las pruebas).
- Secuencia: aviso sonoro y visual (2.6 s) → sacudida (3.6 s) → polvo, asentamiento (profundidad +0.12
  a +0.42 m), interferencia LoRa (q × 0.35 durante 3 s), ansiedad +0.22, HR +18, SpO₂ −1.1.
- El polvo tarda en decantar y afecta a visibilidad **y** oxigenación: el castigo del pánico se
  arrastra en el tiempo.

---

## 8. Capas MR y lectura de la información

| Capa | Contenido | Uso del jugador |
| --- | --- | --- |
| Passthrough | Mundo físico, luz natural | Referencia de realidad |
| Fusión | Gateways, baliza del superviviente, retícula de precisión, túnel de extracción, drones, etiquetas AR, anillos RF | Leer el estado del enlace y del rescate |
| Diagnóstico | Rejilla, contornos estructurales, nube de puntos de polvo, anillos de escaneo | Entender el espacio y la calidad del aire |

Los elementos holográficos son materiales aditivos con `depthTest: false`: se comportan como
proyecciones que atraviesan los escombros, no como objetos físicos.

---

## 9. Interfaz y accesibilidad

- HUD con paneles de signos vitales, barómetro/LoRa y protocolo de rescate; registro de radio de 4
  líneas; objetivo contextual; temporizador.
- Retroalimentación redundante: color + texto + audio (latido, beeps de radio, alarmas) + háptica
  visual (pulso rojo, túnel de FOV, tinte de hipoxia).
- Controles alternativos: teclado (1–4, T, Espacio, L, P, M), ratón, rueda y táctil (mantener el
  anillo de respiración).
- Responsive hasta 700 px de ancho; sin dependencias externas ni imágenes pesadas.
- Pausa automática al perder el foco; reinicio rápido (R) tras el informe.

---

## 10. Balance verificado por pruebas

`npm test` valida tres políticas de jugador sobre la pipeline real:

| Escenario | Resultado esperado | Medición actual |
| --- | --- | --- |
| Sereno (respira perfecto, calibra, transmite) | Victoria | ~1:40–2:10, SpO₂ mín. ≈ 86 %, precisión 0.3 m, rango S/A |
| Pánico (hiperventila, tiembla, spam de TX) | Derrota biométrica | ~1:15 por hipoxia, 0 paquetes entregados, ~2.5 réplicas/min |
| Calma sin transmitir | Sin rescate | el protocolo nunca pasa de IDLE; muere por hipoxia |

Los umbrales viven en `src/state.js → CFG`; cualquier ajuste de dificultad es un cambio de datos.

---

## 11. Hoja de ruta hacia hardware real

1. **Biometría real:** Web Bluetooth (`heart_rate_service`) para bandas HR; SpO₂ en dispositivos que
   lo expongan. Sin sensor, mantener el modelo actual como "simulación fisiológica".
2. **Barómetro real:** `PressureSensor` del móvil o BME280 por Web Serial/Bluetooth; misma escala
   hPa/m y la calibración ya implementada.
3. **Respiración real:** micrófono con análisis de envolvente, o cámara (rPPG) como entrada opcional.
4. **LoRa real:** gateway LoRaWAN → WebSocket (MQTT/ChirpStack) sustituyendo `Lora.transmit()` por un
   publish y recibiendo los `gateway rx` para la triangulación.
5. **Visor:** WebXR `immersive-ar` con `hit-test` para anclar la retícula y los drones al suelo real;
   el HUD ya está separado en DOM y la escena es un `THREE.Scene` estándar.
6. **Multijugador de socorro:** rol de operador de rescate que ve el mismo reporte y decide la
   estrategia junto a la IA.

---

## 12. Créditos y notas

- Código y diseño: proyecto RESWATCH.
- Motor: [three.js](https://threejs.org) r180 + Vite.
- Todo el arte (concreto, escombros, polvo, etiquetas, pantalla del reloj, hologramas) y el audio se
  generan por procedimiento en el navegador.
- Pieza de ficción especulativa; no es un sistema real de rescate.
