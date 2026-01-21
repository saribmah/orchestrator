# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orchestrator is a multi-agent feature implementation tool that coordinates Claude Code and Codex CLIs. It automates the workflow: feature description → prompt generation (Codex) → implementation (Claude) → review (Codex) → iterate until approved.

## Project Structure

Bun workspace monorepo with three packages:

```
packages/
├── core/     # Server, orchestration logic, event bus
├── cli/      # Command-line interface
└── ui/       # React web interface
```

## Commands

```bash
# Install dependencies
bun install

# Type checking
bun run typecheck

# Linting
bun run lint

# Start core server
bun run --filter @orchestrator/core start

# Start UI dev server
bun run --filter @orchestrator/ui dev

# Run CLI
bun run --filter @orchestrator/cli start "Feature description"

# CLI with options
bun run --filter @orchestrator/cli start "Feature" --max-iterations 5 --verbose
bun run --filter @orchestrator/cli start "Feature" --auto
bun run --filter @orchestrator/cli start "Feature" --auto-commit  # Commit after approval
bun run --filter @orchestrator/cli start "Feature" -C /path
bun run --filter @orchestrator/cli start --resume
```

## Architecture

### Workflow Loop
```
Codex (prompt generation) → Claude (implementation) → Codex (review) → [APPROVED or iterate]
                                                                              ↓
                                                               Claude (auto-commit if enabled)
```

### Core Package (`packages/core/`)

- **`server.ts`** - Hono HTTP server with REST API and SSE endpoints
- **`orchestrator.ts`** - Main coordination logic, manages the iteration loop
- **`bus.ts`** - Event bus for pub/sub with 30s event buffering for late-joining clients
- **`sse.ts`** - SSE stream management, subscribes to bus and forwards to clients
- **`state.ts`** - Session persistence to `~/.orchestrator/sessions/`
- **`types.ts`** - TypeScript interfaces and event types
- **`agents/claude.ts`** - Claude CLI wrapper (10min timeout)
- **`agents/codex.ts`** - Codex CLI wrapper (5min timeout, read-only sandbox)
- **`prompts/templates.ts`** - Prompt template builders

### CLI Package (`packages/cli/`)

- **`index.ts`** - Thin HTTP client that communicates with core server, listens to SSE for real-time updates

### UI Package (`packages/ui/`)

- React + Vite application
- **`api.ts`** - API client with fetch and EventSource for SSE
- **`components/`** - Landing, NewSession, SessionList, SessionView

### Event Flow

```
Orchestrator → bus.publish(event) → SSE subscribers → Browser/CLI
                     ↓
              Event buffer (30s, 100 events max)
                     ↓
              Late-joining clients receive buffered events
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List all sessions |
| `/sessions` | POST | Start new session |
| `/sessions/:id` | GET | Get session state |
| `/sessions/:id/resume` | POST | Resume session |
| `/sessions/:id/respond` | POST | Respond to question |
| `/sessions/:id/events` | GET | SSE event stream |
| `/stats` | GET | Server stats |

### Approval Detection

Review is approved if output contains (case-insensitive): "APPROVED", "LGTM", or "LOOKS GOOD"

## Conventions

- Use Bun instead of Node.js/npm/pnpm
- Agent functions return `{success: boolean, output: string, error?: string}` tuple pattern
- Events flow through the bus - use `bus.publish()` or `emitEvent()` helper
- SSE connections auto-replay buffered events for late joiners
