#!/usr/bin/env bun

import { parseArgs } from "util";
import { orchestrate } from "./orchestrator";
import { loadState, getStateFilePath } from "./state";
import type { OrchestratorOptions } from "./types";

const HELP_TEXT = `
Orchestrator: Multi-Agent Feature Implementation Tool

Usage:
  orchestrator "<feature description>" [options]
  orchestrator -f <file> [options]
  orchestrator --resume [options]

Options:
  -f, --file <file>         Read feature description from file
  -r, --resume              Resume last session (or specific session with --session)
  -s, --session <id>        Session ID to resume (use with --resume)
  -n, --max-iterations <n>  Maximum review cycles (default: 5)
  -i, --interactive         Prompt before each step (default: true)
  --auto                    Run without prompts
  -v, --verbose             Show full agent outputs
  -C, --working-dir <dir>   Directory to work in (default: cwd)
  -h, --help                Show this help message

Examples:
  orchestrator "Add user authentication with JWT"
  orchestrator -f feature.md -C ./my-project
  orchestrator --resume -v
  orchestrator --resume --session 20250120-143052
  orchestrator "Add dark mode toggle" --max-iterations 5 --verbose
  orchestrator "Refactor database layer" --auto

Sessions are saved to: ~/.orchestrator/sessions/
`;

function printHelp() {
  console.log(HELP_TEXT);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: {
        type: "string",
        short: "f",
      },
      resume: {
        type: "boolean",
        short: "r",
        default: false,
      },
      session: {
        type: "string",
        short: "s",
      },
      "max-iterations": {
        type: "string",
        short: "n",
        default: "5",
      },
      interactive: {
        type: "boolean",
        short: "i",
        default: true,
      },
      auto: {
        type: "boolean",
        default: false,
      },
      verbose: {
        type: "boolean",
        short: "v",
        default: false,
      },
      "working-dir": {
        type: "string",
        short: "C",
        default: process.cwd(),
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // Handle resume
  if (values.resume) {
    const sessionId = values.session as string | undefined;
    const savedState = await loadState(sessionId);
    if (!savedState) {
      if (sessionId) {
        console.error(`Error: Session "${sessionId}" not found`);
      } else {
        console.error("Error: No saved session found to resume");
      }
      console.error(`Sessions directory: ${getStateFilePath()}`);
      process.exit(1);
    }

    console.log(`Resuming session ${savedState.id}...`);

    const options: OrchestratorOptions = {
      maxIterations: savedState.maxIterations,
      interactive: values.auto ? false : (values.interactive as boolean),
      verbose: values.verbose as boolean,
      workingDir: savedState.workingDir,
    };

    try {
      const result = await orchestrate(savedState.feature, options, savedState);

      if (result.status === "approved") {
        console.log("\nFeature implementation complete!");
        process.exit(0);
      } else {
        console.log("\nFeature implementation did not complete successfully");
        console.log(`Final status: ${result.status}`);
        process.exit(1);
      }
    } catch (error) {
      console.error("\nFatal error:", error);
      process.exit(1);
    }
    return;
  }

  let feature = positionals[0];

  // Read from file if specified
  if (values.file) {
    try {
      const file = Bun.file(values.file as string);
      feature = await file.text();
      feature = feature.trim();
    } catch {
      console.error(`Error: Could not read file "${values.file}"\n`);
      process.exit(1);
    }
  }

  if (!feature) {
    console.error("Error: Feature description is required\n");
    printHelp();
    process.exit(1);
  }

  const options: OrchestratorOptions = {
    maxIterations: parseInt(values["max-iterations"] as string, 10),
    interactive: values.auto ? false : (values.interactive as boolean),
    verbose: values.verbose as boolean,
    workingDir: values["working-dir"] as string,
  };

  try {
    const result = await orchestrate(feature, options);

    if (result.status === "approved") {
      console.log("\nFeature implementation complete!");
      process.exit(0);
    } else {
      console.log("\nFeature implementation did not complete successfully");
      console.log(`Final status: ${result.status}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("\nFatal error:", error);
    process.exit(1);
  }
}

main();
