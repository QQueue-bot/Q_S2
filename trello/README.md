# Trello helper

Local helper scripts/config for Trello board access.

## Files
- `config.json` — local credentials and board metadata
- `trello.sh` — simple API wrapper for common board operations

## Usage

```bash
./trello/trello.sh me
./trello/trello.sh board
./trello/trello.sh lists
./trello/trello.sh cards
./trello/trello.sh add-card "Card title" <listId>
./trello/trello.sh move-card <cardId> <listId>
./trello/trello.sh rename-list <listId> "New name"
./trello/trello.sh add-list "List name"
./trello/trello.sh archive-list <listId>
```

Credentials are stored locally in `trello/config.json`.
Rotate the token if it was shared in chat.
