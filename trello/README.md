# Trello helper

Local helper scripts/config for Trello board access.

## Files
- `config.json` — local credentials and board metadata
- `trello.sh` — simple API wrapper for common board operations

## Usage

Low-level helper:

```bash
./trello/trello.sh me
./trello/trello.sh board
./trello/trello.sh lists
./trello/trello.sh cards
./trello/trello.sh add-card "Card title" "Backlog"
./trello/trello.sh move-card "Card title" "In Progress"
./trello/trello.sh rename-list "Backlog" "Next"
./trello/trello.sh add-list "Waiting"
./trello/trello.sh archive-list "Trello Starter Guide"
```

Friendly kanban wrapper:

```bash
./trello/kanban.sh show
./trello/kanban.sh cards
./trello/kanban.sh add "Write docs" "Backlog"
./trello/kanban.sh move "Write docs" "In Progress"
```

Credentials are stored locally in `trello/config.json`.
Rotate the token if it was shared in chat.

Names can be used instead of raw Trello IDs for cards and lists as long as they match exactly and are unique.
