# Retroalimentación de pruebas — browser-harness

**Fecha:** 2026-06-23
Pruebas hechas por el agente contra el Chrome real (CDP `172.24.240.1:9223`).

## Lo que funciona (verificado)
- `session status` / `session start`: attach al Chrome de Windows (Chrome 149). ✓
- `tabs`: lista pestañas con `targetId`, marca la activa. ✓
- `open` / `navigate` / `focus` / `close`: navegación y manejo de pestañas. ✓
- `snapshot`: título + URL + texto visible + árbol ARIA. ✓
- `screenshot`: PNG guardado en `workspace/`, validado visualmente. ✓
- `eval`: ejecuta JS y devuelve el resultado. ✓
- `click`: clic por selector, navegación resultante detectada. ✓
- Manejo de errores: comando desconocido y selector inexistente → `{ ok:false, error }`. ✓

## Hallazgos corregidos durante las pruebas
1. **`page.accessibility` no existe en Playwright 1.59** → se cambió `snapshot` a
   `locator('body').ariaSnapshot()`.
2. **Errores de Playwright traían códigos ANSI** que ensuciaban el JSON → se limpian en
   `output.fail()`.
3. **`close` dejaba estado stale** (apuntando a la pestaña cerrada) → ahora limpia el
   `activeTargetId` con `clearActiveTarget()`.

## Pendiente / mejoras futuras (no bloquean)
- `pdf` requiere Chrome headless; sobre un Chrome con interfaz puede fallar. Documentado.
- `snapshot` no expone "refs" estables por elemento (como openclaw). Si se necesita
  interacción por ref en vez de selector, añadir un sistema de refs.
- `launch` (attach-o-lanzar) está implementado pero no se pudo probar el camino de
  *lanzar* porque el CDP ya estaba arriba. Validar cerrando Chrome y corriendo
  `bh session start`.
- Sugerir `bh snapshot` automáticamente en errores de selector no encontrado.
