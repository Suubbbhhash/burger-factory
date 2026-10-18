# The Burger Factory — Workspace Guidelines

## Mandatory Chat History Preservation
Every single chat turn (user prompt and assistant output) in this project MUST be preserved in:
`d:/Burger_factory/PROJECT_CHAT_LOG.txt`

1. The `.agents/hooks.json` lifecycle hook triggers `node scripts/sync_chat_log.cjs` on `PostInvocation` and `Stop`.
2. Any assistant working in this workspace must keep `PROJECT_CHAT_LOG.txt` up-to-date with verbatim transcripts of all prompts, outputs, and actions taken.
