# Orchestrator

Multi-agent feature implementation tool that coordinates Claude Code and Codex CLIs.

## Workflow

```
User defines feature → Codex generates prompt → Claude implements → Codex reviews → Loop until approved
```

## Project Structure

This is a Bun workspace monorepo with three packages:

```
packages/
├── core/     # Server, orchestration logic, event bus
├── cli/      # Command-line interface
└── ui/       # React web interface
```

## Installation

```bash
bun install
```

## Usage

### Start the Server

The core server must be running for both CLI and UI to work:

```bash
bun run --filter @orchestrator/core start
# or
cd packages/core && bun run start
```

Server runs at `http://localhost:3100` by default.

### CLI

```bash
# Basic usage
bun run --filter @orchestrator/cli start "Add user authentication with JWT"

# With options
bun run --filter @orchestrator/cli start "Add dark mode toggle" --max-iterations 5 --verbose

# Auto mode (no prompts)
bun run --filter @orchestrator/cli start "Refactor database layer" --auto

# Specify working directory
bun run --filter @orchestrator/cli start "Add hello world function" -C /path/to/project

# Resume last session
bun run --filter @orchestrator/cli start --resume
```

### Web UI

```bash
bun run --filter @orchestrator/ui dev
```

Opens at `http://localhost:5173`. Features:
- Start new sessions with custom options
- View existing sessions
- Real-time activity log via SSE
- Interactive question/answer for non-auto sessions

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --max-iterations` | Max review cycles | 5 |
| `-i, --interactive` | Prompt before each step | true |
| `--auto` | Run without prompts | false |
| `--auto-commit` | Automatically commit after approval | false |
| `-v, --verbose` | Show full agent outputs | false |
| `-C, --working-dir` | Directory to work in | cwd |
| `--resume` | Resume last session | - |
| `-h, --help` | Show help message | - |

## API Endpoints

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

## Architecture

### Packages

**@orchestrator/core**
- `server.ts` - Hono HTTP server with SSE support
- `orchestrator.ts` - Main coordination logic
- `bus.ts` - Event bus for pub/sub with buffering
- `sse.ts` - SSE stream management
- `state.ts` - Session persistence (~/.orchestrator/sessions/)
- `agents/claude.ts` - Claude CLI wrapper (10min timeout)
- `agents/codex.ts` - Codex CLI wrapper (5min timeout)
- `prompts/templates.ts` - Prompt templates

**@orchestrator/cli**
- `index.ts` - CLI that communicates with core server via HTTP/SSE

**@orchestrator/ui**
- React + Vite application
- Real-time updates via EventSource (SSE)
- Components: Landing, NewSession, SessionList, SessionView

### Event Flow

```
Orchestrator → bus.publish(event) → SSE subscribers → Browser/CLI
                     ↓
              Event buffer (30s, 100 events max)
                     ↓
              Late-joining clients receive buffered events
```

## Development

```bash
# Type checking
bun run typecheck

# Linting
bun run lint

# Run core server in watch mode
cd packages/core && bun run dev

# Run UI in dev mode
cd packages/ui && bun run dev
```

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://github.com/anthropics/claude-code) (`claude` command)
- [Codex CLI](https://github.com/openai/codex) (`codex` command)
