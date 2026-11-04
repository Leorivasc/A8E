# VBXE — roadmap de funcionalidad y fidelidad

Este documento es el plan operativo para cerrar la implementación VBXE de
jsA8E. El contrato de hardware sigue siendo [AHRM 12.4, VideoBoard XE](../AHRM/12.%20Internal%20devices/4.%20VideoBoard%20XE.md); Altirra 4.40 se usa como
referencia diferencial, no como sustituto de AHRM ni como certificación de
hardware físico.

El estado detallado de registros, VRAM, MEMAC, XDL, mapas de atributos y
blitter permanece en [`VBXE.md`](VBXE.md). Este documento añade el orden de
trabajo, los criterios de salida, los diagramas y la ruta de validación.

## Qué significa «VBXE funcional»

Hay tres niveles distintos y no deben mezclarse:

La auditoría de limpieza de VBXE mantiene las APIs de diagnóstico y
compatibilidad porque siguen siendo utilizadas por runtime, snapshots o tests;
la limpieza se limitó a tablas duplicadas y control redundante del scheduler.

| Nivel | Definición | Estado |
| --- | --- | --- |
| Compatibilidad práctica | Software VBXE real arranca y ejecuta XDL, mapas, MEMAC, blitter e IRQ en el runtime principal. | **Alcanzado** |
| Fidelidad raster | Los cambios GTIA/VBXE dentro de una scanline se componen por spans y coinciden con Altirra en las escenas cubiertas. | **En progreso** |
| Producto completo | La ruta worker presenta el plano RGB, la suite visual es reproducible y las diferencias con hardware están documentadas. | **Pendiente de validación** |

La compatibilidad práctica no requiere esperar a la arbitraje exacta de cada
slot local ni a la ruta worker. El selector VBXE sigue desactivado por defecto
y, cuando está activo, selecciona deliberadamente el runtime principal.

## Arquitectura y flujo de datos

```text
                   CPU / ANTIC / GTIA
                           |
                 registros, VRAM, MEMAC, IRQ
                           v
                    +-------------+
                    | vbxe.js     |
                    | estado FX   |
                    +------+------+ 
                           |
             VSync latch  |  XDL + mapa por línea
                           v
        +------------------+------------------+
        |                                     |
        v                                     v
  GTIA event queue                    VBXE line state
  colores + PRIOR                     overlay + atributos
        |                                     |
        +------------------+------------------+
                           v
                  compositor por spans
          prioridad / transparencia / colisiones
                           |
              +------------+------------+
              |                         |
              v                         v
       plano Atari indexado       plano VBXE RGB
              |                         |
              +------------+------------+
                           v
                 renderer main-thread
                    (WebGL o Canvas 2D)

       worker: OffscreenCanvas compone el plano VBXE; falta la regresión comparativa
```

La regla importante es que VBXE no reemplaza ANTIC ni GTIA. El compositor
debe conservar los identificadores de capa —background, PF0–PF3/P5 y P0–P3—
y no intentar reconstruir prioridad únicamente desde colores RGB finales.

## Orden de ejecución de una scanline

```text
inicio de línea
      |
      +--> ANTIC/GTIA generan píxeles y metadatos de prioridad
      |
      +--> CPU puede escribir GTIA/VBXE
      |       `-> se encolan eventos con ciclo horizontal
      |
      +--> VBXE avanza XDL, repeat, scroll, mapa y fetches
      |
      +--> se cierra la línea
              |
              +--> dividir en [x0,x1) según eventos
              +--> seleccionar PF/background por estado GTIA del span
              +--> aplicar overlay, mapa, transparencia y prioridad
              +--> actualizar COLDETECT
              `--> publicar planos de presentación
```

La agenda local ya existe y conserva una salida agregada compatible para el
blitter. No se debe cambiar el orden MEMAC ni añadir excepciones sólo por una
hipótesis visual: hace falta un diagnóstico que muestre una diferencia
horizontal reproducible.

## Etapas de trabajo

### Etapa 0 — baseline y contrato

**Estado: completada, mantenerla como puerta de entrada.**

- Ejecutar `npm run test:vbxe:full` desde `jsA8E/`.
- Confirmar que la suite cubre registros, XDL, mapas, MEMAC, blitter, IRQ y
  software real.
- Revisar que `VBXE.md`, los README, los tests y `implementation/NOTES.md`
  describan el mismo comportamiento.

**Salida:** baseline reproducible y documentación sin contradicciones.

### Etapa 1 — compositor GTIA por spans

**Estado: parcialmente completada.**

- Mantener la cola temporal de `COLPF0–3`, `COLBK` y `PRIOR`.
- Aplicar cambios de color y prioridad a cada intervalo horizontal.
- Conservar los ganadores P/M y excluir objetos ocultos por `PRIOR`.
- Añadir regresiones para eventos en el primer, último y mismo ciclo.

**Salida:** cambios GTIA mid-line visibles y deterministas sin VBXE overlay.

### Etapa 2 — overlay XDL por spans

**Estado: parcialmente completada.**

- Reproducir standard, lores, hires y texto por intervalos, respetando los
  límites narrow/normal/wide ya validados.
- Aplicar transparencia de color 0/`$F`, paleta y prioridad en cada span.
- Cubrir cambios de `VIDEO_CONTROL`, paleta, scroll y XDL durante una línea.
- Verificar transiciones entre anchos y entre planos Atari/VBXE.

La ruta `applyGtiaSpans()` ya reconstruye overlay y playfield por intervalo,
incluyendo standard, lores, hires y texto en los planos de presentación
correspondientes. Los límites narrow/normal/wide, la transparencia y la
prioridad cubierta tienen regresiones. Siguen pendientes los cambios de
registros VBXE dentro de la línea y el cruce completo de todas las
combinaciones de overlay con modos GTIA especiales.

**Salida:** overlay correcto cuando el estado GTIA cambia dentro de la línea.

La persistencia del estado XDL ya está resuelta: AHRM reinicia parámetros
visuales en VSync, pero conserva las direcciones y strides de overlay y
attribute map; `verticalSync()` mantiene ahora esos latches y reinicia sólo
los parámetros visuales. La regresión multi-frame está en
`vbxe_device_state`.

### Etapa 3 — mapas de atributos por spans

**Estado: parcialmente completada; replay GTIA/PF3 inicial implementado.**

- Reutilizar el estado real de fila, contador de scroll, overscroll, tamaño de
  celda y avance de dirección.
- Aplicar paleta, P0–P3, PF0–PF3/P5, reverse y transparencia por celda/span.
- Cubrir `AtMapOn`, `AtMapOff`, cambio de dirección, reload y límite de 43 celdas.
- Recargar también el buffer al cambiar de fila dentro de una entrada repetida;
  este borde ya tiene regresión en `vbxe_device_state`.
- Añadir escenas que cambien GTIA y mapa durante la misma línea; ya existe una
  regresión de PF3/GTIA para los planos legacy y hires.

**Salida:** mapas correctos en líneas normales y en cambios mid-line.

La geometría ya sigue `OvMisc` en narrow, normal y wide, incluso sin overlay
activo, tanto en el plano legacy como en el plano hires. El compositor ahora
reproduce por spans el PF3 y el modo GTIA observado en la cola de eventos; la
salida de esta etapa aún no se considera alcanzada mientras no reproduzca
cambios de registros VBXE del mapa ni el cruce completo con overlay hires/texto
y timing por fase.

### Etapa 4 — modos GTIA, prioridad y colisiones

**Estado: matriz base implementada y regresada; diferenciales de escenas aún
pendientes.**

- Completar la matriz GTIA 9/10/11 con modos ANTIC 2–F y fuentes bitmap/carácter.
- Validar PF2/PF3, máscaras, inversión, transparencia y prioridad FX 1.20,
  1.24 y 1.26.
- Completar las combinaciones restantes de `COLMASK`/`COLDETECT`, P0+P1/P5 y
  mapas de atributos.
- Convertir cada diferencial estable en una regresión determinista.

La matriz de grupos PF/P5/P/M y las tablas de prioridad legacy/full ya tienen
una regresión determinista en `vbxe_priority_collision_matrix`; los probes XEX
existentes cubren además `COLMASK`/`COLDETECT`, P0+P1 y P5. La salida completa
de esta etapa aún requiere ampliar escenas reales con transparencia, mapas y
los perfiles/modos que todavía no tienen diferencial visual.

**Salida:** cada combinación soportada tiene regla AHRM, prueba y resultado
  diferencial documentado.

### Etapa 5 — registros, MEMAC, reset y snapshots

**Estado: funcional y con auditoría determinista de bordes completada.**

- Revisar bits ignorados, valores de lectura y latches de todos los registros.
- Probar ambos bancos `$D640`/`$D740`, warm reset, power cycle y VSync latch.
- Cubrir MEMAC A/B con CPU, ANTIC, solapamiento, Ultimate1MB y blitter activo.
- Restaurar snapshots durante XDL activo, mapa activo y blitter en progreso.

La regresión `vbxe_register_snapshot` cubre los dos bancos de registros,
readback, bits ignorados, VSync, MEMAC A y restauración de XDL/blitter activo;
`vbxe_device_state` cubre además warm reset, power cycle, configuración y
persistencia de VRAM. Continúan como límites de fidelidad el arbitraje por
fase y la interacción con expansiones externas durante una ejecución real.

**Salida:** ningún camino cubierto depende sólo de una suposición o de un
  test indirecto.

### Etapa 6 — temporización del blitter

**Estado: agenda local implementada; validación diferencial y coordenadas
del orden físico y la validación horizontal de MEMAC pendientes.**

- Ejecutar los diagnósticos continuous/restart de attribute-map en Altirra.
- Comparar el borde azul/rojo y el campo de finalización persistente.
- Si aparece una diferencia, aislarla entre XDL, reload del mapa, MEMAC e IRQ.
- La agenda ya reserva 912 slots locales por scanline: overlay en fases pares,
  con los inicios narrow/normal/wide alineados a la tabla de Altirra,
  lecturas MEMAC en fase 1, escrituras CPU en fase 3, XDL y mapa después del
  área activa, y blitter en el residuo. Falta validar el orden físico y el
  consumo ciclo a ciclo del residuo de MEMAC/blitter.

**Salida:** acuerdo reproducible de timing de baseline, overlay, mapa continuo y
mapa reiniciado; la precisión por slot se declara sólo si existe marcador
horizontal suficiente.

La implementación ya aplica la actualización XDL fija de 22 ciclos de AHRM,
independientemente de los bytes decodificados; las líneas repetidas no generan
una segunda actualización. La excepción restante es el orden físico de cada
acceso MEMAC, el consumo ciclo a ciclo del residuo por el blitter y su
comparación con Altirra.

### Etapa 7 — software real y comparación visual

**Estado: en progreso; el corpus headless ya tiene un gate visual de progreso,
pero la comparación diferencial con Altirra sigue pendiente.**

- Mantener las puertas de Popeye, Galaga, DACTest, Textmode Test, Crysis,
  Celeste, D600, Falcon y Phoenix.
- Reforzar el harness XEX: `runXex({ awaitEntry: false })` y el avance de
  `cycleCounter` no prueban por sí solos que el programa haya alcanzado su
  escena.
- La primera puerta fuerte ya está implementada en
  `vbxe_xex_scene_marker.test.js`: un XEX mínimo escribe dos marcadores RAM y
  el harness espera esos valores. El breakpoint durante el boot no es fiable
  en headless, por lo que la regresión usa memoria observable; los programas
  reales todavía necesitan marcadores equivalentes.
- La regresión `vbxe_real_software_scene.test.js` comprueba los puntos de 120,
  240, 360 y 480 frames, captura cada programa y exige un frame no negro cuyo
  digest RGBA no coincida con ningún frame de reset para los cinco casos
  cubiertos. Galaga queda explícitamente boot-only porque su captura headless
  queda negra; Celeste, D600 y Phoenix también quedan boot-only porque sus
  capturas coinciden con el conjunto de reset. Esto evita aceptar tanto las
  variantes temporales de la pantalla inicial común como un frame negro
  transitorio; se mantiene además la puerta de marcador RAM del XEX mínimo. El
  gate también exige que la huella SHA-256 de los 64 KiB de RAM difiera del
  conjunto de reset en los cuatro casos boot-only. Esto prueba ejecución
  observable, pero no sustituye una marca específica de escena ni una golden
  image de Altirra.
- Usar la instancia Chromium/CDP como ruta de captura provisional: el corpus
  FX1.26 avanza 120 frames en WebGL2 y Textmode Test cambia de digest al
  seleccionar el modo 4. Esta evidencia aún debe convertirse en comparación
  Altirra reproducible.
- Seleccionar escenas estables de software real que usen overlay, texto, mapas
  y blitter enlazado.
- Capturar el mismo número de frames en jsA8E y Altirra con PAL/NTSC, perfil,
  página y paleta fijados.
- Comparar RGB, capas, colisiones y geometría; registrar diferencias
  intencionales en `VBXE.md`.

**Salida:** evidencia visual automatizable de progreso para todas las rutas
declaradas; la equivalencia requiere además la comparación Altirra pendiente.

### Etapa 8 — worker y cierre de producto

**Estado: integración y gate browser implementados; ejecución depende de CDP.**

- Mantener el plano RGB VBXE dentro del render de `OffscreenCanvas` del worker;
  ya no se fuerza el fallback main-thread cuando VBXE está activo.
- Mantener equivalencia con WebGL, Canvas 2D, snapshots y automation API.
- Ejecutar `npm run test:vbxe:browser` con Chromium en CDP; el gate valida
  worker/fallback WebGL2 y Canvas2D, capturas no vacías y hash PNG equivalente,
  y restaura la URL.
- Validar selector, reset, `$D600/$D700` y PAL/NTSC; la variante Canvas2D ya
  tiene cobertura automatizada y la baseline provisional queda persistida en
  `jsA8E/tests/fixtures/vbxe_browser_golden.json`.
- Para una referencia independiente, `A8E_VBXE_REFERENCE` permite comparar
  capturas JSON de Altirra con el mismo esquema sin modificar el gate interno.
- Ejecutar la suite completa y actualizar la matriz de soporte.

**Salida:** VBXE habilitable desde la aplicación normal sin seleccionar
  explícitamente el runtime principal.

## Dependencias entre etapas

```text
baseline/contrato
        |
        v
GTIA spans -----------+
        |              |
        v              v
overlay spans ---> mapas por spans ---> modos/colisiones
        |                    |              |
        +--------------------+--------------+
                             v
                  registros/MEMAC/snapshots
                             |
                             v
                    blitter phase timing
                             |
                             v
                 software + comparación visual
                             |
                             v
                         worker/UI
```

Las etapas 4 y 5 pueden avanzar en paralelo después de la base. La etapa 6
debe consumir diagnósticos de las etapas 2 y 3; no conviene ajustar su
scheduler antes de que el compositor pueda mostrar el marcador correcto.

## Puertas de validación

### Regresión rápida

```sh
cd jsA8E
npm run test:gtia-spans
node tests/vbxe_device_state.test.js
node tests/vbxe_blitter_state.test.js
node tests/vbxe_rambo_bus.test.js
```

### Suite VBXE completa

```sh
cd jsA8E
npm run test:vbxe:full
```

### Evidencia diferencial

Cada cambio que afecte a imagen o timing debe incluir:

1. diagnóstico XEX reproducible;
2. captura o lectura equivalente en Altirra 4.40;
3. resultado jsA8E con el mismo perfil y página;
4. regresión automatizada o explicación explícita de por qué aún no es
   automatizable;
5. entrada nueva en `implementation/NOTES.md`.

## Criterio de cierre

El objetivo de **VBXE funcional** se considera cerrado cuando:

- `npm run test:vbxe:full` termina sin fallos;
- el corpus de software real sigue arrancando y ejecutando;
- standard, lores, hires, texto, mapas, MEMAC, blitter, IRQ, reset y snapshots
  tienen contrato y cobertura;
- los cambios mid-line cubiertos usan spans y tienen comparación diferencial;
- las limitaciones de fase exacta, hardware físico y worker están separadas de
  las capacidades funcionales y documentadas.

El objetivo de **fidelidad completa** requiere además cerrar las etapas 6–8 y
no debe declararse sólo porque el software arranque.

## Referencias del repositorio

- [`VBXE.md`](VBXE.md): diseño, registros, estado y matriz de soporte.
- [`../jsA8E/README.md`](../jsA8E/README.md): uso del navegador y selector VBXE.
- [`jsA8E/CORE.md`](jsA8E/CORE.md): integración del dispositivo en el core.
- [`jsA8E/RENDER.md`](jsA8E/RENDER.md): planos RGB y presentación.
- [`jsA8E/WORKER.md`](jsA8E/WORKER.md): frontera worker y limitación actual.
- [`NOTES.md`](NOTES.md): bitácora de cada mejora y diferencial.
