# Continuous Chat History Logging Rule

## Mandate
For every user prompt and assistant response in this project ("The Burger Factory"):
1. The conversation history MUST be logged and preserved in `d:/Burger_factory/PROJECT_CHAT_LOG.txt`.
2. When answering user requests, ensure that any key decisions, architectural changes, prompts, and outputs are appended to `d:/Burger_factory/PROJECT_CHAT_LOG.txt`.
3. Never truncate or delete previous conversation entries in `PROJECT_CHAT_LOG.txt`. Always append new turns in chronological order with turn header, timestamp, user prompt, and assistant response.
