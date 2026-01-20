# Orchestrator

Multi-agent feature implementation tool that coordinates Claude Code and Codex CLIs.

## Workflow

```
User defines feature → Codex generates prompt → Claude implements → Codex reviews → Loop until approved
```

## Installation

```bash
bun install
```

## Usage

```bash
# Basic usage
bun run src/index.ts "Add user authentication with JWT"

# With options
bun run src/index.ts "Add dark mode toggle" --max-iterations 5 --verbose

# Auto mode (no prompts)
bun run src/index.ts "Refactor database layer" --auto

# Specify working directory
bun run src/index.ts "Add hello world function" -C /path/to/project
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --max-iterations` | Max review cycles | 5 |
| `-i, --interactive` | Prompt before each step | true |
| `--auto` | Run without prompts | false |
| `-v, --verbose` | Show full agent outputs | false |
| `-C, --working-dir` | Directory to work in | cwd |
| `-h, --help` | Show help message | - |

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://github.com/anthropics/claude-code) (`claude` command)
- [Codex CLI](https://github.com/openai/codex) (`codex` command)

## Architecture

- `src/index.ts` - CLI entry point
- `src/orchestrator.ts` - Main coordination logic
- `src/agents/claude.ts` - Claude CLI wrapper
- `src/agents/codex.ts` - Codex CLI wrapper
- `src/prompts/templates.ts` - Prompt templates
- `src/types.ts` - TypeScript interfaces
