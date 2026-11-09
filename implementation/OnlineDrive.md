# Online Drive / sincronización remota de la Disk Library

Estado: **Fase 1 (MVP de Workspace remoto) implementada en jsA8E y validada
contra un Nextcloud real** (Firefox y Chromium, jsA8E servido desde el mismo
servidor que Nextcloud; pull/push entre browsers y colisiones con sufijo `(1)`
funcionan como se diseñó). Fases 2 (repositorio incremental con
tombstones) y 3 (automático y nativo) siguen en diseño. Rama de trabajo:
`OnlineDrive`.

## Decisiones tomadas (2026-11-08)

- Se empieza por el **MVP de Workspace remoto** (un único `workspace.a8e`).
- Los **tombstones** se diseñan ahora (ver más abajo) y se implementan en la
  Fase 2: en el MVP el paquete sólo contiene discos montados y no hay borrados
  que propagar, así que no aportarían nada todavía.
- **Web primero, nativo después.** Se acepta explícitamente la diferencia de
  paridad con A8E nativo hasta que exista el adaptador (ver «Paridad»).
- La validación real se hará contra el Nextcloud del autor (carpeta compartida
  y cuenta con contraseña de aplicación).

## Problema

La Disk Library de jsA8E vive hoy en el almacenamiento local de cada browser.
Aunque la exportación/importación de paquetes `.a8e` funciona y conserva los
discos, carpetas, revisiones y workspace, usar más de un navegador obliga a
llevar manualmente el paquete actualizado, reemplazar la copia antigua y
recordar cuál es la más reciente. El objetivo es que una misma biblioteca de
trabajo pueda sincronizarse opcionalmente con un repositorio remoto.

## Decisión de alcance

El remoto no será una segunda sección de la Biblioteca ni una colección
"online" distinta. Será el par remoto opcional de la Full Library local:

```text
IndexedDB local  <---- sincronización ---->  repositorio WebDAV
```

La biblioteca local continúa siendo la copia de trabajo y debe funcionar sin
red. El remoto permite continuar el trabajo desde otro browser, computador o,
cuando exista el adaptador equivalente, A8E nativo.

La sincronización podrá tener dos alcances:

- **Biblioteca completa:** entradas, carpetas, revisiones y workspace.
- **Workspace actual:** sólo los discos montados y su ascendencia de carpetas.

El segundo alcance ataca el caso cotidiano de trasladar una sesión de trabajo
sin descargar necesariamente toda la colección.

Una colección remota pública/compartida, con otros permisos o navegación
separada, es un producto diferente y queda fuera de esta propuesta inicial.

## Formato remoto propuesto

El formato existente ya es apropiado: `library.json` describe entradas,
carpetas, revisiones, hashes y workspace; los ATR/XEX son blobs direccionados
por SHA-256. Un directorio WebDAV remoto contendrá:

```text
A8E/
├── .a8e-remote.json   identidad del repositorio y metadatos de protocolo
├── library.json       manifiesto de la biblioteca
└── blobs/
    ├── <sha256>.atr
    └── <sha256>.xex
```

`library.json` conserva el contrato de intercambio actual. Los blobs son
inmutables y deduplicables: una revisión nueva produce un hash nuevo; no se
sobrescribe el contenido de otra revisión.

El archivo `.a8e-remote.json` debe identificar el repositorio para impedir que
una configuración local apunte accidentalmente a otro directorio compatible.
No debe contener contraseñas, tokens ni rutas locales.

## Protocolo de sincronización

No se debe sincronizar ATR por nombre ni usar una política silenciosa de
"last writer wins". Eso puede destruir cambios realizados en otro browser.

Flujo propuesto:

1. Al conectar o sincronizar, descargar el manifiesto remoto y su `ETag`.
2. Comparar el manifiesto con el estado local y descargar sólo los blobs que
   falten localmente.
3. Para publicar cambios locales, subir primero los blobs de hash ausente y
   después actualizar `library.json`.
4. Actualizar el manifiesto con la precondición WebDAV/HTTP `If-Match` usando
   el `ETag` leído. Si otro cliente publicó antes, el servidor debe rechazar
   la escritura.
5. Ante ese rechazo, volver a descargar, fusionar historias y conservar las
   versiones binarias incompatibles como revisiones/conflictos explícitos.
   Nunca descartar una variante automáticamente.
6. Publicar el manifiesto fusionado con el nuevo `ETag`.

La política de conflictos debe reutilizar la filosofía vigente de la Library:
preservación no destructiva y copias/revisiones separadas para ATR/XEX, no un
merge binario ficticio.

Las escrituras de sectores de un ATR no deben disparar una petición remota por
cada operación. El emulador persiste primero la copia local; la sincronización
puede ejecutarse manualmente, tras un período breve de inactividad, al expulsar
el medio y como intento de salida. La salida del browser nunca puede ser la
única garantía de subida.

## MVP recomendado

Antes de implementar el repositorio incremental completo, se puede ofrecer un
MVP de **Workspace remoto**: almacenar un único `workspace.a8e` en WebDAV,
protegido con `ETag`/`If-Match`. El paquete existente ya preserva los discos
montados, sus revisiones y sus asignaciones. Sirve para validar WebDAV, CORS,
autenticación y conflictos con una superficie más pequeña.

La solución final preferida es el directorio `library.json` + `blobs/`, porque
evita transferir toda la biblioteca en cada cambio y deduplica el contenido.

## Configuración de conexión

La configuración pertenece a la Biblioteca y no al contenido exportable:

```text
Sincronización remota
  URL de carpeta WebDAV: https://servidor/.../A8E/
  Usuario:              ...
  Contraseña de aplicación: ...
  [Probar conexión]
```

El botón de prueba debe comprobar HTTPS (excepto `localhost` para desarrollo),
lectura/escritura WebDAV, soporte de `ETag` y la presencia/identidad del
repositorio. Debe diagnosticar específicamente una restricción CORS, una
autenticación rechazada, falta de permisos de escritura o un remoto que no es
una biblioteca A8E.

En la primera conexión no se reemplaza nada de forma implícita. La interfaz
debe ofrecer, según los estados detectados:

- publicar la biblioteca local si el remoto está vacío;
- traer y fusionar el remoto si la biblioteca local está vacía;
- fusionar preservando conflictos si ambos contienen datos.

La política inicial recomendada es sincronización manual. Más adelante pueden
ofrecerse modos automáticos tras inactividad y al abrir la aplicación, siempre
mostrando cambios pendientes y conflictos.

## Credenciales y seguridad

Una aplicación web estática no tiene un almacén de secretos equivalente al
llavero del sistema. Guardar una contraseña o token en IndexedDB/localStorage
lo deja disponible para JavaScript del mismo origen, incluido un posible XSS;
no se considera almacenamiento seguro.

Decisión inicial propuesta:

- solicitar una **contraseña de aplicación** WebDAV en cada sesión;
- mantenerla sólo en memoria;
- persistir únicamente URL, usuario, identidad del remoto y preferencias de
  sincronización;
- no incluir secretos en `.a8e`, `library.json`, snapshots ni diagnósticos;
- exigir HTTPS salvo desarrollo local.

Puede añadirse una comodidad opcional que delegue el recuerdo de credenciales
en el gestor propio del browser mediante autenticación HTTP estándar. A8E no
debe leer ni almacenar esa contraseña y el diseño no debe depender de que todos
los browsers muestren o recuerden el diálogo de autenticación igual.

Para sincronización totalmente transparente, la alternativa más segura es un
backend propio con sesión `HttpOnly` que guarde la credencial WebDAV en el lado
servidor. Eso requiere operar cuentas y un servicio adicional. OAuth/OIDC con
PKCE es otra alternativa cuando el proveedor la soporte, pero no reemplaza por
sí sola las ventajas de una cookie `HttpOnly` para una aplicación estática.

## Requisito de servidor y navegador

El WebDAV debe permitir CORS desde el origen de jsA8E y permitir/exponer las
cabeceras necesarias, al menos `ETag` e `If-Match`. El diagnóstico de conexión
debe identificar este problema porque es probable en instalaciones de
Nextcloud/ownCloud o nginx que no hayan sido configuradas para jsA8E.

Una futura implementación nativa debe mantener la paridad de la Full Library.
Un cliente WebDAV con HTTPS sin dependencias externas es un trabajo relevante;
no se debe ocultar esa diferencia ni afirmar paridad hasta que exista el
adaptador nativo o se apruebe explícitamente una entrega web inicial.

## Indicador y controles de interfaz

La interfaz de biblioteca visible usa la vista clásica de cuatro drives:
`D1:` a `D4:`. Aunque el núcleo conserva ocho slots internos para
compatibilidad, esta propuesta no añade controles de montaje ni confunde la
sincronización con esas unidades.

Ubicación propuesta:

```text
Barra superior
  [...][ botón existente Disk Library con LED superpuesto ][...]

Panel Disk Library, barra de título
  [ disco | Disk Library | ruta actual | estado de operación | conexión/sync ]
```

- El LED superpuesto en el botón existente de Disk Library informa del estado
  remoto incluso cuando el panel está cerrado.
- El control de conexión/sincronización va al extremo derecho de la barra de
  título. No va en la barra de herramientas: esa fila ya reúne acciones sobre
  archivos (subir, crear, borrar, importar y exportar) y es horizontalmente
  densa.
- En móvil, el mismo LED se muestra como insignia del acceso inferior `Disks`;
  el control se usa dentro de la barra de título del panel.
- En pantallas estrechas el control puede mostrar sólo icono y LED, siempre
  con texto accesible y tooltip.

Se reutiliza el recurso gráfico LED verde actual; no hace falta crear un LED
azul. El contexto (botón de Biblioteca, tooltip y texto del panel) distingue
su función de la actividad SIO. Estados propuestos:

| LED | Estado |
|---|---|
| Apagado/gris | No hay remoto configurado o la sesión no está conectada. |
| Verde fijo | Remoto conectado y biblioteca sincronizada. |
| Verde pulsante | Sincronización en progreso. |
| Amarillo fijo | Hay cambios locales pendientes de sincronizar. |
| Rojo pulsante | Error de conexión o conflicto que requiere atención. |

El control cambia según el estado: `Configurar`, `Conectar`, `Sincronizar` o
`Revisar`. Al reiniciar el browser, una conexión configurada vuelve a estado
no conectado porque la contraseña no se persiste. El tooltip y el texto deben
dar el detalle que el color no transmite, por ejemplo: “Biblioteca remota:
conectada; sincronizada hace 3 min” o “3 cambios locales pendientes”.

El LED de actividad de medio ya existente conserva su semántica: verde para
lecturas y amarillo para escrituras SIO. No debe reutilizarse para tráfico de
red.

## Fase 1: Workspace remoto (implementado)

Archivos: `jsA8E/js/app/remote_workspace.js` (cliente y sincronización, sin
DOM), `jsA8E/js/app/remote_sync_ui.js` (control, LED y diálogo),
`jsA8E/tests/remote_workspace.test.js` (dentro de `test:automation`).

El módulo sólo usa `fetch` y la API pública de la Disk Library
(`flush`, `exportWorkspacePackage`, `previewImport`, `importPackage`), de modo
que funciona igual con y sin worker y no hizo falta tocar `emulator_worker.js`
ni `app_proxy.js`.

### Layout remoto

```text
<carpeta WebDAV>/
├── .a8e-remote.json   {format:"a8e-remote", protocol:1, kind:"workspace", repoId}
└── workspace.a8e      paquete ZIP existente (sólo discos montados + ascendencia)
```

La carpeta WebDAV debe existir; A8E no la crea. `repoId` se genera al conectar a
una carpeta vacía y se compara en conexiones posteriores.

### Algoritmo de `sync()`

1. `library.flush()` y exportación del workspace local; se calcula una
   *huella* determinista (entradas, carpetas, hash de cada revisión, montajes y
   protección; sin marcas de tiempo del export).
2. `GET workspace.a8e` con `If-None-Match: <último ETag>`.
   - `404`: remoto vacío; si hay discos montados se publica con
     `If-None-Match: *`.
   - `304`/mismo ETag: el remoto no cambió. Si la huella local difiere de la
     última sincronizada se publica con `If-Match`.
   - ETag distinto: se descarga y se fusiona con `previewImport` +
     `importPackage` (política existente «keep both», no destructiva). En la
     primera sincronización con datos en ambos lados se pide confirmación. Si el
     local estaba limpio basta la fusión; si tenía cambios se republica con
     `If-Match` del ETag recién leído.
3. `412`/`409` en la subida: otro cliente publicó antes; se olvida el ETag, se
   vuelve a descargar y fusionar (máx. 5 intentos). Nunca se sobrescribe.
4. Se guarda ETag, huella y hora de sincronización.

Consecuencias del diseño actual:

- Sólo viajan los discos **montados** (D1–D4 visibles en la UI): es el alcance
  «Workspace actual» de este documento.
- Si dos browsers editaron el mismo disco, cada lado conserva ambas variantes
  como entradas separadas (`DOC.ATR`, `DOC(1).ATR`); es la política vigente de
  la Library para ATR/XEX. La variante de cada lado es la que queda montada.
- Un pull restaura los montajes del remoto (llama a `mountFile`), por eso se
  hace `flush()` antes de fusionar. Sólo se descarga cuando el ETag cambió.
- La sincronización es **manual** (botón de la barra de título). Las ediciones
  locales sólo ponen el LED en amarillo; las escrituras de sectores nunca
  generan tráfico de red.
- `replaceFile` desmonta un disco montado (flujo existente de la UI); un disco
  sustituido y no vuelto a montar deja de formar parte del workspace.

### Diagnóstico de conexión

`client.connect()` (botón *Connect* del diálogo) distingue: URL inválida o no
HTTPS (se permite `http` sólo en `localhost`/`127.0.0.1`/`[::1]`), credenciales
en la URL, fallo de red/CORS (el navegador no distingue ambos y el mensaje lo
dice), `401` (autenticación rechazada), `403` (sin permisos), carpeta
inexistente (`404`/`405` al subir), ETag no expuesto por CORS (`no-etag`), carpeta
con `.a8e-remote.json` que no es A8E y protocolo más nuevo. Con el remoto vacío
crea la identidad con `If-None-Match: *`. La escritura del `workspace.a8e` se
verifica en la primera subida.

### Interfaz

Barra de título del panel Disk Library, al extremo derecho: LED + botón
(`Configure` / `Connect` / `Sync` / `Syncing` / `Review`) y un engranaje que abre
el diálogo (URL, usuario, contraseña de aplicación). El LED reutiliza
`assets/leds.png` (gris / verde / verde pulsante / amarillo / rojo pulsante) y
se muestra además como insignia sobre el botón de la barra superior y el acceso
móvil `Disks`. El tooltip y `aria-label` llevan el detalle («sincronizada hace
3 min», «cambios locales pendientes», texto del error). Se persisten sólo URL,
usuario, `repoId`, último ETag/huella y hora (localStorage); la contraseña vive
en memoria y se pide de nuevo tras recargar.

### Limitaciones conocidas del MVP

- Sin sincronización automática ni al expulsar el medio.
- Sin descarga/subida incremental: cada publicación sube todo el workspace.
- No se propagan borrados de ningún tipo (no aplican: sólo discos montados).
- Sin `PROPFIND`/`MKCOL`: el protocolo usa sólo `GET`, `HEAD`, `PUT`.
- Sin paridad nativa.

## Servidor: CORS y Nextcloud

El navegador envía preflight (`OPTIONS`) porque se usan `Authorization`,
`If-Match`, `If-None-Match` y `Content-Type: application/octet-stream`. El
servidor debe responder para el origen de jsA8E:

```text
Access-Control-Allow-Origin:   https://<origen de jsA8E>   (o http://localhost:<puerto>)
Access-Control-Allow-Methods:  GET, HEAD, PUT, OPTIONS
Access-Control-Allow-Headers:  Authorization, If-Match, If-None-Match, Content-Type
Access-Control-Expose-Headers: ETag
```

No debe usarse `Allow-Credentials`: el cliente usa `credentials: "omit"` y
envía `Authorization` manualmente. Nextcloud/ownCloud no añaden estas cabeceras
por sí solos para un origen arbitrario: hay que añadirlas en el proxy inverso
(nginx/Apache) para la ruta `/remote.php/dav/` (y responder `OPTIONS` sin
autenticación con 204) o usar una app de CORS. URL típica de Nextcloud:
`https://servidor/remote.php/dav/files/<usuario>/A8E/` con una **contraseña de
aplicación** (Ajustes → Seguridad), nunca la contraseña principal.

### Plan de prueba con Nextcloud

1. Crear la carpeta `A8E` y una contraseña de aplicación.
2. Configurar CORS para el origen de prueba y abrir jsA8E (o `localhost`).
3. *Connect*: debe crear `.a8e-remote.json`. Verificar que Nextcloud devuelve y
   expone `ETag` en `GET`/`PUT` y acepta `If-Match` e `If-None-Match: *`.
4. Montar un disco en D1, *Sync*: debe aparecer `workspace.a8e`.
5. Segundo browser/perfil: *Connect* + *Sync*; comprobar que trae y monta el
   disco. Editar en uno, sincronizar ambos; repetir editando en los dos.

## Fase 2: tombstones (diseño)

Problema: sin registro de borrados, un `Delete` local se «resucita» en la
siguiente fusión con un remoto que aún conserva el elemento. Solución prevista,
compatible con schema v1 (campo opcional que un lector antiguo ignora):

```json
"tombstones": [
  { "kind": "entry",  "id": "disk-docs", "deletedAt": "2026-11-08T12:00:00Z",
    "sha256": "<hash vigente al borrar>", "by": "browser-a" },
  { "kind": "folder", "id": "folder-games", "deletedAt": "..." }
]
```

Reglas de fusión:

- Un tombstone cubre sólo las revisiones que el borrador conocía: si la entrada
  remota/local tiene una revisión que **no desciende** de `sha256` (editada
  después del borrado en otro browser), gana la edición y el tombstone se
  descarta. La pérdida de datos por borrado concurrente es imposible.
- Un tombstone sin edición posterior mueve la entrada a la papelera local
  (recuperable), no la purga: el borrado remoto nunca elimina bytes de forma
  irreversible.
- Un tombstone de carpeta sólo se aplica si la carpeta queda vacía tras
  aplicar los tombstones de entradas; si no, se ignora.
- Restaurar desde la papelera retira el tombstone (se publica sin él).
- Recolección: un tombstone se puede descartar tras un período configurable
  (p. ej. 90 días) o cuando todos los pares conocidos lo vieron; mientras tanto
  evita resurrecciones.
- Los blobs referenciados sólo por entradas con tombstone no se borran del
  remoto en esta fase (no hay GC remoto; es un trabajo posterior explícito).

Renombrar y mover entradas/carpetas se resuelven con la marca `modifiedAt` de
la entrada (gana la más reciente; empate determinista por id), sin pérdida de
contenido, porque identidad y bytes no cambian.

## Fase 2: repositorio incremental (diseño)

`library.json` + `blobs/<sha256>.<tipo>` como describe «Formato remoto
propuesto». Cambios respecto al MVP: subir primero los blobs ausentes
(`PUT … If-None-Match: *`, inmutables e idempotentes) y luego el manifiesto con
`If-Match`; descargar sólo los blobs que falten; fusionar manifiestos con el
grafo de revisiones (`parentId`/hash), no con `libraryVersion`, que es un
contador local y no permite detectar divergencia entre browsers. El lector de
manifiestos debe verificar SHA-256 y límites de tamaño igual que el importador
de paquetes. Sin `PROPFIND`: la lista de blobs se deriva del manifiesto, y
`MKCOL` sólo se necesita si se opta por crear `blobs/` automáticamente.

## Paridad con A8E nativo

Se acepta entregar primero la versión web. Requisito pendiente para declarar
paridad con la Full Library: un cliente WebDAV con HTTPS sin dependencias en A8E
nativo que use el mismo layout, el mismo `.a8e-remote.json` y las mismas reglas
de ETag/If-Match, con fixtures compartidos. Mientras tanto, A8E nativo puede
importar/exportar manualmente el mismo `workspace.a8e`.
