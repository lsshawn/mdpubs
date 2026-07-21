#!/usr/bin/env bash
#
# Compare two .env files by KEY — show which keys differ, are missing, or
# only-in-one. Values are NOT printed by default (they're secrets); use -v
# to show them.
#
# Usage:
#   ./scripts/diff-env.sh .env .env.production
#   ./scripts/diff-env.sh -v .env .env.production   # also show values
#
# Exit code is 0 when the two files have the same keys with the same values,
# 1 when they differ (handy in CI / pre-deploy checks).

set -euo pipefail

show_values=0
if [[ "${1:-}" == "-v" ]]; then
  show_values=1
  shift
fi

FILE_A="${1:-}"
FILE_B="${2:-}"

if [[ -z "$FILE_A" || -z "$FILE_B" ]]; then
  echo "usage: $0 [-v] <env-a> <env-b>" >&2
  exit 2
fi
for f in "$FILE_A" "$FILE_B"; do
  [[ -f "$f" ]] || { echo "❌ $f not found" >&2; exit 2; }
done

# Extract KEY=VALUE lines into an associative array, ignoring comments/blanks.
# Handles optional `export `, trims surrounding single/double quotes on values.
declare -A A B
load_env() {
  local file="$1"
  local -n dest="$2"   # dest is a nameref to the target array
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    # strip leading whitespace + optional `export `
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#export }"
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue   # skip comments/blanks
    key="${line%%=*}"
    val="${line#*=}"
    if [[ "$val" == \"*\" ]]; then val="${val%\"}"; val="${val#\"}";
    elif [[ "$val" == \'*\' ]]; then val="${val%\'}"; val="${val#\'}"; fi
    dest["$key"]="$val"
  done < "$file"
}
load_env "$FILE_A" A
load_env "$FILE_B" B

name_a="$(basename "$FILE_A")"
name_b="$(basename "$FILE_B")"

# Union of all keys, sorted.
mapfile -t keys < <(printf '%s\n' "${!A[@]}" "${!B[@]}" | sort -u)

differ=0
only_a=() only_b=() changed=()
for k in "${keys[@]}"; do
  in_a=0; in_b=0
  [[ -v A["$k"] ]] && in_a=1
  [[ -v B["$k"] ]] && in_b=1
  if   (( in_a && !in_b )); then only_a+=("$k"); differ=1
  elif (( !in_a && in_b )); then only_b+=("$k"); differ=1
  elif [[ "${A[$k]}" != "${B[$k]}" ]]; then changed+=("$k"); differ=1
  fi
done

reveal() { (( show_values )) && printf ' = %q' "$1" || printf ''; }

if (( ${#only_a[@]} )); then
  echo "▸ only in $name_a:"
  for k in "${only_a[@]}"; do echo "    $k$(reveal "${A[$k]}")"; done
fi
if (( ${#only_b[@]} )); then
  echo "▸ only in $name_b:"
  for k in "${only_b[@]}"; do echo "    $k$(reveal "${B[$k]}")"; done
fi
if (( ${#changed[@]} )); then
  echo "▸ different values:"
  for k in "${changed[@]}"; do
    if (( show_values )); then
      printf '    %s\n        %s: %q\n        %s: %q\n' "$k" "$name_a" "${A[$k]}" "$name_b" "${B[$k]}"
    else
      echo "    $k"
    fi
  done
fi

if (( differ )); then
  echo "❌ files differ"
  exit 1
else
  echo "✅ identical keys and values (${#keys[@]} keys)"
fi
