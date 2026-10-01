#!/usr/bin/env bash
# Benchmark de latencia de bh: mide la mediana (ms) de comandos típicos contra una
# página de prueba. Uso: scripts/bench.sh [corridas=7]
# Requiere Chrome con CDP accesible. Abre una pestaña propia y la cierra al final.
set -u
cd "$(dirname "$0")/.."
RUNS=${1:-7}
BH=./bin/bh

now() { date +%s%N; }
median() { sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}'; }

# mide RUNS veces "$@" y devuelve la mediana en ms; marca ERR si algún intento falla
bench() {
  local label=$1; shift
  local times=() err=0
  for _ in $(seq 1 "$RUNS"); do
    local s e out
    s=$(now); out=$("$@" 2>&1); [ $? -ne 0 ] && err=1; e=$(now)
    times+=($(( (e - s) / 1000000 )))
  done
  local m; m=$(printf '%s\n' "${times[@]}" | median)
  printf '%-34s %6s ms%s\n' "$label" "$m" "$([ $err = 1 ] && echo '  (hubo errores)')"
}

$BH open https://example.com --json --allow >/dev/null 2>&1 || { echo "No se pudo abrir la pestaña de prueba"; exit 1; }
$BH eval "document.body.innerHTML='<button id=b>Go</button><input id=i><p id=p>hola mundo</p>'; 1" --json --allow >/dev/null 2>&1

echo "== bh bench (mediana de $RUNS corridas, incluye arranque del CLI) =="
bench "tabs"                      $BH tabs --json
bench "session status"            $BH session status --json
bench "eval 1+1"                  $BH eval "1+1" --json --allow
bench "eval innerText"            $BH eval "document.body.innerText" --json --allow
bench "click #b"                  $BH click "#b" --json --allow
bench "fill #i"                   $BH fill "#i" "abc" --json --allow
bench "press Shift"               $BH press Shift --json --allow
bench "screenshot"                $BH screenshot --json --out workspace/bench-shot.img
bench "snapshot"                  $BH snapshot --json
if $BH text --json >/dev/null 2>&1; then
  bench "text"                    $BH text --json
  bench "els"                     $BH els --json
fi
echo "-- fallo rápido (selector inexistente) --"
s=$(now); $BH click "#no-existe" --json --allow >/dev/null 2>&1; e=$(now)
printf '%-34s %6s ms\n' "click #no-existe (error)" "$(( (e - s) / 1000000 ))"

$BH close --json --allow >/dev/null 2>&1
rm -f workspace/bench-shot.img
