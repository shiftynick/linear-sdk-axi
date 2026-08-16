import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { renderHelp, renderOutput } from "../toon.js";

export const SETUP_HELP = `usage: linear-sdk-axi setup hooks
Install or repair agent SessionStart hooks for linear-sdk-axi ambient context.

examples:
  linear-sdk-axi setup hooks
`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError("Unknown setup action", "VALIDATION_ERROR", [
      "Run `linear-sdk-axi setup hooks`",
    ]);
  }

  installSessionStartHooks({
    marker: "linear-sdk-axi",
    binaryNames: ["linear-sdk-axi"],
  });

  return renderOutput([
    "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
    renderHelp([
      "Restart your agent session to receive linear-sdk-axi ambient context",
    ]),
  ]);
}
