#!/usr/bin/env bash
# Crée config.js (lu par l'appli) à partir de SUPABASE_URL et SUPABASE_ANON_KEY.
# Les valeurs viennent des variables d'environnement, ou d'un fichier .env local.
# Sans ces variables, config.js est vide : l'appli marche, sans buzzers connectés.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_ANON_KEY:-}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "// Buzzers connectés non configurés (SUPABASE_URL / SUPABASE_ANON_KEY absents)." > config.js
  echo "config.js : pas de configuration Supabase, buzzers connectés désactivés."
  exit 0
fi

case "$URL" in
  https://*) ;;
  *) echo "SUPABASE_URL doit commencer par https://" >&2; exit 1 ;;
esac

# Garde-fou : jamais de clé secrète dans une page web
case "$KEY" in
  sb_secret_*) echo "Refusé : c'est une clé secrète. Utilisez la clé publique (anon / publishable)." >&2; exit 1 ;;
esac
if [[ "$KEY" == eyJ* ]]; then
  PAYLOAD="$(printf '%s' "$KEY" | cut -d. -f2 | tr '_-' '/+')"
  while [ $(( ${#PAYLOAD} % 4 )) -ne 0 ]; do PAYLOAD="${PAYLOAD}="; done
  if printf '%s' "$PAYLOAD" | base64 -d 2>/dev/null | grep -q '"role" *: *"service_role"'; then
    echo "Refusé : c'est la clé service_role. Utilisez la clé anon." >&2
    exit 1
  fi
fi

# Échappement minimal pour une chaîne JavaScript
js() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > config.js <<JS
// Fichier généré par scripts/make-config.sh : ne pas modifier, ne pas commiter.
window.MIAMS_CONFIG = {
  supabaseUrl: "$(js "${URL%/}")",
  supabaseAnonKey: "$(js "$KEY")"
};
JS
echo "config.js : buzzers connectés configurés pour ${URL%/}"
