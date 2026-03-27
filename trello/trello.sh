#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

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

api_put() {
  local path="$1"; shift
  curl -sS -X PUT "$BASE$path?key=$KEY&token=$TOKEN" "$@"
}

find_list_id_by_name() {
  local name="$1"
  python3 - "$name" <<'PY'
import json, subprocess, sys
name = sys.argv[1].strip().lower()
out = subprocess.check_output(['bash','-lc','./trello.sh lists'], text=True, cwd='.')
lists = json.loads(out)
matches = [x for x in lists if x['name'].strip().lower() == name and not x.get('closed')]
if len(matches) == 1:
    print(matches[0]['id'])
    sys.exit(0)
if len(matches) > 1:
    print(f"Ambiguous list name: {sys.argv[1]}", file=sys.stderr)
    sys.exit(2)
print(f"List not found: {sys.argv[1]}", file=sys.stderr)
sys.exit(1)
PY
}

find_card_id_by_name() {
  local name="$1"
  python3 - "$name" <<'PY'
import json, subprocess, sys
name = sys.argv[1].strip().lower()
out = subprocess.check_output(['bash','-lc','./trello.sh cards'], text=True, cwd='.')
cards = json.loads(out)
matches = [x for x in cards if x['name'].strip().lower() == name and not x.get('closed')]
if len(matches) == 1:
    print(matches[0]['id'])
    sys.exit(0)
if len(matches) > 1:
    print(f"Ambiguous card name: {sys.argv[1]}", file=sys.stderr)
    sys.exit(2)
print(f"Card not found: {sys.argv[1]}", file=sys.stderr)
sys.exit(1)
PY
}

resolve_list() {
  local value="$1"
  if [[ "$value" =~ ^[A-Fa-f0-9]{24}$ ]]; then
    echo "$value"
  else
    find_list_id_by_name "$value"
  fi
}

resolve_card() {
  local value="$1"
  if [[ "$value" =~ ^[A-Fa-f0-9]{24}$ ]]; then
    echo "$value"
  else
    find_card_id_by_name "$value"
  fi
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
    list_id="$(resolve_list "${3:?listId or list name required}")"
    api_post "/cards" --data-urlencode "name=$name" --data-urlencode "idList=$list_id"
    ;;
  move-card)
    card_id="$(resolve_card "${2:?cardId or card name required}")"
    list_id="$(resolve_list "${3:?listId or list name required}")"
    api_put "/cards/$card_id" --data-urlencode "idList=$list_id"
    ;;
  rename-list)
    list_id="$(resolve_list "${2:?listId or list name required}")"
    name="${3:?new list name required}"
    api_put "/lists/$list_id" --data-urlencode "name=$name"
    ;;
  add-list)
    name="${2:?list name required}"
    api_post "/lists" --data-urlencode "name=$name" --data-urlencode "idBoard=$BOARD_SHORT_ID"
    ;;
  archive-list)
    list_id="$(resolve_list "${2:?listId or list name required}")"
    api_put "/lists/$list_id/closed" --data-urlencode "value=true"
    ;;
  help|--help|-h)
    cat <<'EOF'
Commands:
  me
  board
  lists
  cards
  add-card "Card title" <listId|list name>
  move-card <cardId|card name> <listId|list name>
  rename-list <listId|list name> "New name"
  add-list "List name"
  archive-list <listId|list name>

Notes:
  - Card and list names must be exact when using names instead of IDs.
  - If multiple cards/lists share the same name, the command will error as ambiguous.
EOF
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
