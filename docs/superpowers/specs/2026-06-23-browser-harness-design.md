# Browser Harness — Design Spec

**Fecha:** 2026-06-23
**Estado:** Aprobado (diseño)

## Propósito

Un conjunto de herramientas propias para que el agente (Claude Code) controle Chrome
directamente, sin depender de OpenClaw. Debe poder **conectarse** a una sesión de Chrome
existente o **lanzar** una nueva, y exponer comandos ergonómicos para navegar, leer e
interactuar con páginas. Todo artefacto generado se guarda en un `workspace/` dedicado.

## Decisiones de diseño

- **Conexión:** auto — *attach-o-lanzar*.
- **Perfil:** el perfil real de Chrome del usuario (sesiones ya logueadas).
- **Interfaz:** CLI stateless con salida `--json` (buenas prácticas para agentes que
  manejan por terminal), apoyado en una librería interna fina.
- **Ubicación:** `~/projects/browser-harness/`.

## Stack

- Node.js (v25 disponible) + **Playwright** (ya usado en el workspace de openclaw).
- Conexión por **CDP** (`chromium.connectOverCDP`).

## Modelo de conexión (auto)

1. Intenta `connectOverCDP` al endpoint configurado
   (por defecto `http://172.24.240.1:9223`, el Chrome de Windows del usuario).
   → reusa el perfil real ya logueado.
2. Si no responde, **lanza Chrome en Windows** vía `chrome.exe` (invocado desde WSL)
   con `--remote-debugging-port` apuntando al `user-data-dir` real, y se conecta.
3. **Limitación documentada:** si Chrome ya está abierto *sin* depuración remota, debe
   cerrarse antes de que el harness pueda relanzarlo con depuración (limitación de Chrome).

Cada comando del CLI: conecta → ejecuta la acción → se desconecta **sin cerrar** el
navegador. No hay demonio. El `targetId` de la pestaña activa se guarda entre comandos.

## Estructura del proyecto

```
browser-harness/
  bin/bh                  # CLI ejecutable (entry point)
  src/
    config.js             # cdpUrl, ruta chrome.exe, user-data-dir, defaults
    session.js            # lógica attach-o-lanzar + manejo de estado/pestaña activa
    commands/             # un archivo por comando
  config.json             # configuración editable por el usuario
  workspace/              # destino de TODO lo generado (screenshots, pdf, datos, downloads)
    .state.json           # targetId de la pestaña activa
  README.md
  package.json
```

## Comandos (todos soportan `--json`)

| Grupo       | Comandos |
|-------------|----------|
| Sesión      | `session start` (attach/lanza), `session status`, `session stop` |
| Tabs        | `tabs`, `open <url>`, `navigate <url>`, `focus <id>`, `close` |
| Ver         | `snapshot` (texto/aria para "leer" la página), `screenshot`, `pdf` |
| Interactuar | `click`, `fill`, `type`, `press`, `hover`, `select` |
| Avanzado    | `eval <js>`, `cookies`, `storage` |

### Convenciones

- `--json` imprime resultado estructurado (para parseo del agente). Sin la bandera,
  salida legible.
- Errores: mensaje claro + código de salida ≠ 0. En modo `--json`, `{ "ok": false, "error": ... }`.
- Comandos idempotentes donde aplique; `session start` es no-op si ya hay conexión.

## Workspace

- `screenshot`, `pdf` y exportaciones de datos se guardan por defecto en
  `browser-harness/workspace/` con nombre + timestamp.
- El usuario puede sobreescribir la ruta de salida con una bandera (`--out`).
- Mantiene el directorio del proyecto limpio (nada de archivos sueltos).

## Estado

- `workspace/.state.json` guarda el `targetId` de la pestaña activa para que comandos
  consecutivos operen sobre la misma pestaña sin re-especificarla.

## Manejo de errores

- CDP inalcanzable → intentar lanzar; si el lanzamiento falla, error claro con la causa
  (p.ej. "Chrome ya abierto sin debugging; ciérralo y reintenta").
- Selector/ref no encontrado → error con sugerencia de correr `snapshot`.
- Timeouts configurables (`--timeout`, default razonable).

## Testing

- Smoke test: `session status` y `tabs` contra el CDP real.
- Cada comando se valida manualmente contra una pestaña real (p.ej. la de Facebook ya
  abierta) durante la implementación.

## Fuera de alcance (YAGNI)

- Demonio persistente / socket de larga vida.
- Soporte multi-navegador (Firefox/WebKit).
- Grabación de trazas, intercepción de red avanzada (se puede añadir luego).
