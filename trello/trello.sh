#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
CFG="config.json"

json_get() {
  python3 - "$1" <<'PY'
import json,sys
key=sys.argv[1]
with open('config.json') as f:
    data=json.load(f)
print(data[key])
PY
}

KEY="$(json_get apiKey)"
TOKEN="$(json_get token)"
BOARD_SHORT_ID="$(json_get boardShortId)"
BASE="https://api.trello.com/1"

api_get() {
  local path="$1"
  if [[ "$path" == *\?* ]]; then
    curl -sS "$BASE$path&key=$KEY&token=$TOKEN"
  else
    curl -sS "$BASE$path?key=$KEY&token=$TOKEN"
  fi
}

api_post() {
  local path="$1"; shift
  curl -sS -X POST "$BASE$path?key=$KEY&token=$TOKEN" "$@"
}

cmd="${1:-board}"
case "$cmd" in
  me)
    api_get "/members/me"
    ;;
  board)
    api_get "/boards/$BOARD_SHORT_ID?fields=name,url,desc,closed"
    ;;
  lists)
    api_get "/boards/$BOARD_SHORT_ID/lists?fields=name,closed,pos"
    ;;
  cards)
    api_get "/boards/$BOARD_SHORT_ID/cards?fields=name,idList,closed,url,due"
    ;;
  add-card)
    name="${2:?card name required}"
    list_id="${3:-}"
    if [[ -z "$list_id" ]]; then
      echo "Usage: $0 add-card \"Card title\" <listId>" >&2
      exit 1
    fi
    api_post "/cards" --data-urlencode "name=$name" --data-urlencode "idList=$list_id"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
