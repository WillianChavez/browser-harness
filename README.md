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
- `bh text [selector|@eN] [--max N]` — texto visible (rápido; reemplaza `eval innerText`).
- `bh els [scope] [--match t] [--max N] [--all]` — elementos interactivos visibles con refs `@e1…`; si hay un modal abierto se limita a él (`scope: dialog`) y queda disponible como `bh text @dialog`.
- `bh snapshot [--no-aria]` — título, URL, árbol ARIA y texto visible.
- `bh screenshot [--full] [--png] [--quality N] [--out archivo]` — captura directa por CDP (JPEG por defecto, ~5× más liviana que PNG).
- `bh pdf [--out archivo]` — PDF (requiere Chrome headless).

### Interactuar
- `bh click <selector>` · `bh fill <selector> <valor>` · `bh type <selector> <texto>`
- `bh press <Key> [selector]` · `bh hover <selector>` · `bh select <selector> <valor...>`

Los selectores son de Playwright (CSS, `text=...`, `role=...`) **o refs `@eN`** devueltos por `bh els`.
Se prefiere el primer coincidente *visible*; si un overlay tapa el elemento, `click` usa `el.click()` por JS y lo reporta (`via: js-fallback`, `warning`). `--no-fallback`/`--force` lo desactivan.
Timeout de acción por defecto 6s (`defaults.actionTimeout`); un selector sin coincidencias falla en ~1.5s con una pista.

### Esperar y encadenar
- `bh wait <selector|@eN|text=...|ms> [--gone]` — espera una condición real.
- `bh batch '<json>'` (o `bh batch -` con JSON por stdin) — varios comandos en **una** llamada: `[["fill","@e2","x"],["click","@e5"],["wait","text=Listo"],["text"]]`. Cada paso pasa por la capa de permisos; se detiene en el primer fallo salvo `--keep-going`.

### Avanzado
- `bh eval "<js>"` — evalúa JS en la página y devuelve el resultado.
- `bh cookies [set <json>]` — lee o escribe cookies.
- `bh storage [session]` — lee local/sessionStorage.

## Flags globales
- `--json` — salida estructurada (recomendado para el agente).
- `--timeout <ms>` — timeout de la acción.
- `--tab <index|targetId>` — opera sobre una pestaña concreta sin cambiar la activa.
- `--time` — añade `ms` y `connectMs` a la salida JSON.
- `--no-daemon` (o `BH_NO_DAEMON=1`) — fuerza modo directo (un proceso por comando).

## Configuración (`config.json`)
- `cdpUrl` — endpoint CDP (default `http://172.24.240.1:9223`, Chrome de Windows).
- `chromePath` — ruta a `chrome.exe` (para lanzar).
- `userDataDir` — perfil real de Chrome.
- `defaults.timeout` (navegación), `defaults.actionTimeout` (click/fill/…; def. 6000), `defaults.handshakeTimeout`.
- `daemonPort` (def. 19333), `daemonIdleMinutes` (def. 30).

## Notas
- **Daemon local** (127.0.0.1): el primer `bh` lanza `src/daemon.js`, que mantiene la conexión CDP viva (~50 ms por comando en vez de 2–4 s con muchas pestañas). Se reinicia solo si cambia el código de `src/`, sale tras 30 min inactivo y ejecuta en serie. Los procesos largos (`fb harvest`, `fb grab`, `x pool`) corren en proceso propio. `bh daemon status|stop|restart`.
- Cada conexión es **attach**: nunca cierra Chrome salvo `bh session stop`.
- Benchmark: `scripts/bench.sh [corridas]` (mediana por comando; línea base y mejora en `workspace/bench-*.txt`).
- La pestaña activa se recuerda en `workspace/.state.json`.
- Para **lanzar**: si Chrome ya está abierto *sin* depuración remota, ciérralo primero
  (limitación de Chrome).
- Todo lo generado (capturas, PDF, datos) se guarda en `workspace/`.
