# browser-harness

Herramientas propias para que el agente controle Chrome vía **CDP**, sin depender de
OpenClaw. Se **conecta** a un Chrome existente o lo **lanza** (perfil real), y expone un
CLI ergonómico con salida `--json`.

## Uso

```bash
./bin/bh <comando> [args] [--json]
```

### Sesión
- `bh session start` — conecta; si no hay CDP, lanza Chrome en Windows y se conecta.
- `bh session status` — estado de la conexión y nº de tabs.
- `bh session stop` — cierra el navegador.

### Tabs
- `bh tabs` — lista las pestañas (`*` = activa).
- `bh open <url>` — abre URL en pestaña nueva (queda activa).
- `bh navigate <url>` — navega la pestaña activa.
- `bh focus <index|targetId>` — fija la pestaña activa.
- `bh close` — cierra la pestaña activa.

### Ver
- `bh snapshot` — título, URL, árbol ARIA y texto visible (para "leer" la página).
- `bh screenshot [--full] [--out archivo]` — captura (por defecto a `workspace/`).
- `bh pdf [--out archivo]` — PDF (requiere Chrome headless).

### Interactuar
- `bh click <selector>` · `bh fill <selector> <valor>` · `bh type <selector> <texto>`
- `bh press <Key> [selector]` · `bh hover <selector>` · `bh select <selector> <valor...>`

Los selectores son selectores de Playwright (CSS, `text=...`, `role=...`, etc.).

### Avanzado
- `bh eval "<js>"` — evalúa JS en la página y devuelve el resultado.
- `bh cookies [set <json>]` — lee o escribe cookies.
- `bh storage [session]` — lee local/sessionStorage.

## Flags globales
- `--json` — salida estructurada (recomendado para el agente).
- `--timeout <ms>` — timeout de la acción.
- `--tab <index|targetId>` — opera sobre una pestaña concreta sin cambiar la activa.

## Configuración (`config.json`)
- `cdpUrl` — endpoint CDP (default `http://172.24.240.1:9223`, Chrome de Windows).
- `chromePath` — ruta a `chrome.exe` (para lanzar).
- `userDataDir` — perfil real de Chrome.
- `defaults.timeout`, `defaults.handshakeTimeout`.

## Notas
- Cada comando conecta y se desconecta **sin cerrar** Chrome (modo attach). No hay demonio.
- La pestaña activa se recuerda en `workspace/.state.json`.
- Para **lanzar**: si Chrome ya está abierto *sin* depuración remota, ciérralo primero
  (limitación de Chrome).
- Todo lo generado (capturas, PDF, datos) se guarda en `workspace/`.
