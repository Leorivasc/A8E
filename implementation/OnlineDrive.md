# Online Drive / sincronización remota de la Disk Library

Estado: propuesta de diseño. No implementado.

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
