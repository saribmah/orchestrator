# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orchestrator is a multi-agent feature implementation tool that coordinates Claude Code and Codex CLIs. It automates the workflow: feature description → prompt generation (Codex) → implementation (Claude) → review (Codex) → iterate until approved.

## Commands

```bash
# Install dependencies
bun install

# Run the tool
bun run src/index.ts "Feature description"

# With options
bun run src/index.ts "Feature" --max-iterations 5 --verbose
bun run src/index.ts "Feature" --auto        # No prompts, fully autonomous
bun run src/index.ts "Feature" -C /path      # Specify working directory
bun run src/index.ts -f feature.md           # Read feature from file
bun run src/index.ts --resume                # Resume last session
```

## Architecture

### Workflow Loop
```
Codex (prompt generation) → Claude (implementation) → Codex (review) → [APPROVED or iterate]
```

### Key Components

- **`src/orchestrator.ts`** - Main coordination logic, manages the iteration loop
- **`src/agents/claude.ts`** - Claude CLI wrapper (10min timeout, spawns `claude -p <prompt> --dangerously-skip-permissions`)
- **`src/agents/codex.ts`** - Codex CLI wrapper (5min timeout, read-only sandbox mode)
- **`src/state.ts`** - Session persistence to `~/.orchestrator/last-session.json` for resume functionality
- **`src/prompts/templates.ts`** - Prompt template builders for implementation and feedback

### Agent Configuration

- **Claude**: 10-minute timeout, searches for binary in `~/.claude/local/claude`, `~/.local/bin/claude`, `/usr/local/bin/claude`, or PATH
- **Codex**: 5-minute timeout, runs with `--sandbox read-only` to prevent changes during prompting/review

### State Management

Session state is persisted to `~/.orchestrator/last-session.json` after every step. Contains feature description, iteration count, agent response history, and `lastFailedStep` for resume recovery.

### Approval Detection

Review is approved if output contains (case-insensitive): "APPROVED", "LGTM", or "LOOKS GOOD"

## Conventions

- Use Bun instead of Node.js/npm/pnpm
- Agent functions return `{success: boolean, output: string, error?: string}` tuple pattern
- Concurrent stdout/stderr reading with timeout protection via `Promise.race()`
