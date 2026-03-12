---
trigger: always_on
description: Rules to optimize token usage and context window efficiency for AI agents.
---

# Token Optimization Rules

To maximize efficiency and reduce costs/latency, all agents MUST follow these rules:

## 1. Discovery & Navigation
- **Prioritize Search**: Use `grep_search` and `find_by_name` instead of exhaustive directory listing or manual file reading.
- **Outline First**: For files > 100 lines, use `view_file_outline` before `view_file`.
- **Targeted Reading**: Always use `StartLine` and `EndLine` in `view_file` to read only relevant blocks. Avoid reading > 300 lines unless necessary.

## 2. Communication
- **Extreme Conciseness**: Skip polite fillers (no "Certainly", "I'd be happy to", etc.).
- **Technical Focus**: Provide summaries in tool calls that are brief and technical.
- **Avoid Repetition**: Do not restate the user's request unless clarifying.

## 3. Operations & Editing
- **Batch Edits**: Use `multi_replace_file_content` for multiple changes in one file instead of multiple calls.
- **Synchronous Commands**: Use `WaitMsBeforeAsync` appropriately to avoid unnecessary `command_status` polling for fast commands.
- **Selective Verification**: Run only relevant tests, not the entire suite, unless final validation is needed.

## 4. Context Management
- **Token Pruning**: Ignore files in `ADDITIONAL_METADATA` that are not relevant to the current task.
- **Minimal History**: Don't repeat previous thought steps in current thoughts unless they provide new insights.
