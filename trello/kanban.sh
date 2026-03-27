#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 1
fi

cmd="$1"
shift || true

case "$cmd" in
  show)
    ./trello.sh lists
    ;;
  cards)
    ./trello.sh cards
    ;;
  add)
    card="${1:?card title required}"
    list="${2:-Backlog}"
    ./trello.sh add-card "$card" "$list"
    ;;
  move)
    card="${1:?card title required}"
    list="${2:?destination list required}"
    ./trello.sh move-card "$card" "$list"
    ;;
  archive)
    card="${1:?card title required}"
    ./trello.sh archive-card "$card"
    ;;
  rename-list)
    from="${1:?current list name required}"
    to="${2:?new list name required}"
    ./trello.sh rename-list "$from" "$to"
    ;;
  add-list)
    list="${1:?list name required}"
    ./trello.sh add-list "$list"
    ;;
  archive-list)
    list="${1:?list name required}"
    ./trello.sh archive-list "$list"
    ;;
  help|--help|-h)
    cat <<'EOF'
Friendly kanban wrapper:
  ./trello/kanban.sh show
  ./trello/kanban.sh cards
  ./trello/kanban.sh add "Card title" [list]
  ./trello/kanban.sh move "Card title" "Doing"
  ./trello/kanban.sh archive "Card title"
  ./trello/kanban.sh rename-list "Backlog" "Next"
  ./trello/kanban.sh add-list "Waiting"
  ./trello/kanban.sh archive-list "Trello Starter Guide"
EOF
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
