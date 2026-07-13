---
name: browser-harness
description: Usar siempre que haya que manejar una sesión de Chrome real (navegar, leer una página, hacer clic/llenar formularios, capturar pantalla, o extraer/cosechar contenido de Facebook) en vez de pedir herramientas de terceros (openclaw, etc.). Cubre conexión attach-o-lanzar por CDP, lectura de páginas, interacción, y recolección de datos hacia un CSV etiquetado.
---

# browser-harness — Chrome propio vía CDP

Ejecutar siempre desde la raíz de este repo: `./bin/bh <comando> --json`.
Salida uniforme `{ok:true,...}` / `{ok:false,error}`. Ver `CLAUDE.md` para las
reglas de seguridad/alcance (no scraping autónomo masivo, confirmar antes de
tocar el host Windows, etc.) — léelas antes de usar `fb harvest`.

## Árbol de decisión

1. **¿Necesito saber si Chrome está conectado / abrirlo?**
   → `bh session status --json` (diagnóstico) · `bh session start --json`
   (attach; lanza Chrome en Windows con el perfil real si no hay CDP).
   Si `session start` falla con "CDP no accesible" y ya hay Chrome abierto en
   Windows: pedir permiso al usuario para cerrarlo (Chrome no expone el
   puerto de depuración si ya hay una instancia sin ese flag).

2. **¿Necesito ver/leer qué pestañas hay o cuál está activa?**
   → `bh tabs --json`.

3. **¿Necesito ir a una URL o cambiar de pestaña?**
   → `bh open <url>` (pestaña nueva) · `bh navigate <url>` (activa) ·
   `bh focus <index|targetId>`.

4. **¿Necesito "leer" el contenido de la página (para decidir algo)?**
   → `bh snapshot --json` (título, URL, texto visible, árbol ARIA). Preferir
   esto sobre `eval` para lectura simple.

5. **¿Necesito evidencia visual (para el usuario o para depurar)?**
   → `bh screenshot [--full] --json` (guarda en `workspace/`, devuelve
   `MEDIA:<path>` en modo texto) · `bh pdf --json`.

6. **¿Necesito interactuar (clic, formulario, tecla)?**
   → `bh click <selector>` · `bh fill <selector> <valor>` ·
   `bh type <selector> <texto>` · `bh press <Key> [selector]` ·
   `bh hover <selector>` · `bh select <selector> <valor...>`.
   Selectores: sintaxis Playwright (CSS, `text=...`, `role=...`).
   Si un selector falla, correr `bh snapshot` primero para ver qué hay
   realmente en la página — no adivinar selectores repetidamente.

7. **¿Necesito ejecutar JS arbitrario o leer cookies/storage?**
   → `bh eval "<js>" --json` · `bh cookies [set <json>]` · `bh storage [session]`.

8. **¿Necesito extraer/etiquetar comentarios de Facebook para un dataset?**
   - Un post ya abierto → `bh fb expand --rounds N` (clic en "ver más" +
     scroll) y luego `bh fb comments --json` (autor, texto exacto,
     permalink por-comentario).
   - El usuario da URLs concretas de posts → `bh fb grab --posts "url1,url2"`
     (cosecha esas URLs exactas a `workspace/harvest.jsonl`, con dedup).
   - Cosecha por página completa (`fb harvest --pages "..."`, con
     `--max-posts`/`--rounds`) SOLO si el usuario lo pide explícitamente y
     acotado — no por iniciativa propia. Ver regla 3 y 4 de `CLAUDE.md`.
   - Priorizar candidatos por vocabulario de violencia/incitación →
     `bh fb scan --max N --json` sobre lo ya cosechado.
   - Guardar una fila evaluada (criterio humano/Claude, no automático) →
     `bh row add --json --data '{"Texto_Original":"...","URL_Original":"...",
     "author":"...","Clase_Toxicidad":"...","Subclase_Toxicidad":"...",...}'`
     — anonimiza autor a `USER_xxx` y deduplica solo. `bh row count --json`
     para ver el avance.

## Errores comunes

- `comando desconocido` → correr `bh --help` para ver el catálogo real.
- Timeout en `click`/`fill` → el selector no existe en el DOM actual; correr
  `bh snapshot` para confirmar antes de reintentar.
- `CDP no accesible` → ver el punto 1 de arriba; no es un fallo silencioso a
  ignorar, hay que resolver la conexión antes de seguir.
