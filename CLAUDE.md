# browser-harness — Chrome controlado vía CDP, como herramienta de Claude

Este repo es un CLI propio (`bh`) para que Claude controle Chrome (perfil real
del usuario, vía CDP) sin depender de servicios de terceros tipo OpenClaw.
No es solo una utilidad de línea de comandos: está pensado para que **Claude
lo use como herramienta** en cualquier sesión de Claude Code sobre este
directorio (ver `.claude/skills/browser-harness/SKILL.md` para el cuándo/cómo).

## Reglas para Claude

1. **Ejecutar siempre desde la raíz del repo**: `./bin/bh <comando> --json`.
   El flag `--json` es obligatorio cuando Claude parsea el resultado (da
   `{ok, ...}` o `{ok:false, error}`); sin él, la salida es solo para humanos.
2. **`workspace/` es el único lugar de artefactos.** Capturas, PDFs, datasets,
   logs de cosecha van ahí (por defecto ya lo hacen). Nunca sueltos en la raíz
   del repo ni en `/tmp`.
3. **No hacer scraping/cosecha masiva y autónoma por iniciativa propia.**
   `fb harvest` (cosecha en bloque por página) solo se usa cuando el usuario
   lo pide explícitamente y con alcance acotado (`--max-posts`, páginas
   concretas). Preferir `fb grab --posts "<url1>,<url2>"` sobre URLs de posts
   que el usuario (o Claude, navegando con criterio) ya identificó como
   relevantes — igual que un humano copiando/pegando, no un bot barriendo.
   Motivo: (a) los ToS de las plataformas, (b) el riesgo real de que la
   cuenta del usuario sea marcada/deslogueada por actividad automatizada
   (ya ocurrió una vez en este proyecto tras una cosecha intensiva).
4. **Medir antes de escalar.** Antes de lanzar una cosecha grande, probar en
   pequeño (1 página, pocos posts) y revisar la calidad/densidad de lo que
   sale (`fb scan`) antes de repetir a mayor escala. No asumir que un enfoque
   rinde solo porque es técnicamente posible.
5. **Acciones destructivas o de red en el host Windows requieren confirmación
   explícita del usuario** antes de ejecutarse: cerrar Chrome (`taskkill`),
   cambios de firewall/portproxy, etc. Explicar qué se va a hacer y por qué
   antes de pedir la confirmación.
6. **`session start` puede lanzar Chrome si no hay CDP disponible**, pero si
   Chrome ya está abierto sin depuración remota, Chrome lo ignora — hay que
   cerrarlo primero (con permiso del usuario). Ver limitación de red: Chrome
   moderno solo expone el DevTools port en `127.0.0.1`; si Claude corre en
   WSL2 y Chrome en Windows, hace falta un port-forward
   (`netsh interface portproxy` + regla de firewall, requiere UAC) — no es un
   bug del harness.
7. **No inventar datos.** Todo lo que se guarda con `row add` / `fb grab` debe
   venir de una página/comentario real, evaluado por Claude o el usuario, con
   URL real. Nunca rellenar campos de etiquetado (`Clase_Toxicidad`, etc.) sin
   haber leído el texto real.
8. **Salida uniforme:** todo comando devuelve `{ok:true, ...}` o
   `{ok:false, error}` en modo `--json`. Si algo fallara sin seguir este
   contrato, es un bug del harness — reportarlo, no parchear con `try/catch`
   silenciosos que oculten el error a la sesión siguiente.

## Comandos (ver README.md para el detalle completo)

Sesión: `session start|status|stop` · Tabs: `tabs|open|navigate|focus|close`
Ver: `text|els|snapshot|screenshot|pdf` · Interactuar: `click|fill|type|press|hover|select` (acepta refs `@eN` de `els`) ·
Esperar/encadenar: `wait|batch` · Daemon: `daemon status|stop|restart`
Avanzado: `eval|cookies|storage` · Facebook: `fb comments|fb posts|fb expand|
fb harvest|fb grab|fb scan` · Dataset: `row add|row count`

## Rendimiento y BrowserOS

`bh` usa un daemon local (conexión CDP persistente, ~50 ms/comando); no hace falta gestionarlo, se reinicia solo
si cambia `src/`. Preferir `bh els` + `@eN` + `bh batch` a ráfagas de `eval` (menos turnos). Detalle en el skill
`browser-harness`. BrowserOS neo está registrado como MCP `browseros` (puente `scripts/browseros-bridge.mjs`, sesión
nueva para cargarlo); **las reglas de arriba valen igual para sus herramientas** (en especial 2, 3, 5 y 7), y no tiene
las sesiones del usuario hasta que éste inicie sesión allí.

## Config

`config.json`: `cdpUrl` (default `http://172.24.240.1:9223`, Chrome de Windows
desde WSL), `chromePath`, `userDataDir` (perfil real), `defaults.actionTimeout`
(6000), `daemonPort` (19333). Editable si el entorno cambia (otra IP de host,
otro usuario de Windows, etc.).
