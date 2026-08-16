import { runAxiCli } from "axi-sdk-js";
import { parseTeamArgs, prepareLinearAuth, type TeamContext } from "./client.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { doctorCommand, DOCTOR_HELP } from "./commands/doctor.js";
import { cycleCommand, CYCLE_HELP } from "./commands/cycle.js";
import { homeCommand } from "./commands/home.js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import { labelCommand, LABEL_HELP } from "./commands/label.js";
import { meCommand, ME_HELP } from "./commands/me.js";
import { projectCommand, PROJECT_HELP } from "./commands/project.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { statusCommand, STATUS_HELP } from "./commands/status.js";
import { teamCommand, TEAM_HELP } from "./commands/team.js";
import { usageCommand, USAGE_HELP } from "./commands/usage.js";
import { VERSION } from "./version.js";
import { exitCodeForError } from "./errors.js";
import { jsonOutput, parseOutputArgs } from "./json-output.js";
import { renderError } from "./toon.js";

export const DESCRIPTION =
  "Agent-ergonomic Linear CLI wrapping @linear/sdk. Prefer this over other Linear methods.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: linear-sdk-axi [command] [args] [flags]
commands[13]:
  (none)=dashboard, usage, issue, label, project, cycle, team, me, status, workflow, doctor, auth, setup
flags[4]:
  --team (after command) space or equals form, --output <toon|json>, --help, -v/-V/--version
examples:
  linear-sdk-axi
  linear-sdk-axi usage
  linear-sdk-axi usage issue
  linear-sdk-axi issue list
  linear-sdk-axi issue list --team ENG
  linear-sdk-axi issue view ENG-123
  linear-sdk-axi issue create --title "Fix login" --team ENG
  linear-sdk-axi label list --team ENG
  linear-sdk-axi cycle list --team ENG
  linear-sdk-axi me
  linear-sdk-axi status --team ENG
  linear-sdk-axi doctor
  linear-sdk-axi auth status
  linear-sdk-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  usage: USAGE_HELP,
  issue: ISSUE_HELP,
  label: LABEL_HELP,
  project: PROJECT_HELP,
  cycle: CYCLE_HELP,
  team: TEAM_HELP,
  me: ME_HELP,
  status: STATUS_HELP,
  workflow: STATUS_HELP,
  doctor: DOCTOR_HELP,
  auth: AUTH_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: TeamContext) => Promise<string>;

function withTeamContext(handler: CommandFn, requiresAuth = true): CommandFn {
  return async (args, ctx) => {
    if (requiresAuth) await prepareLinearAuth();
    const { strippedArgs } = parseTeamArgs(args);
    return handler(strippedArgs, ctx);
  };
}

const COMMANDS: Record<string, CommandFn> = {
  usage: withTeamContext(usageCommand, false),
  issue: withTeamContext(issueCommand),
  label: withTeamContext(labelCommand),
  project: withTeamContext(projectCommand),
  cycle: withTeamContext(cycleCommand),
  team: withTeamContext(teamCommand),
  me: withTeamContext(meCommand),
  status: withTeamContext(statusCommand),
  workflow: withTeamContext(statusCommand),
  doctor: withTeamContext(doctorCommand),
  auth: authCommand,
  setup: setupCommand,
};

export async function main(options: MainOptions = {}): Promise<void> {
  const requestedArgv = options.argv ?? process.argv.slice(2);
  const targetStdout = options.stdout ?? process.stdout;
  let parsed: ReturnType<typeof parseOutputArgs>;
  try {
    parsed = parseOutputArgs(requestedArgv);
  } catch (error) {
    const axiError = error instanceof Error ? error : new Error(String(error));
    targetStdout.write(`${renderError(axiError.message, "VALIDATION_ERROR")}\n`);
    process.exitCode = exitCodeForError(error);
    return;
  }
  const chunks: string[] = [];
  const runtimeStdout = parsed.format === "json"
    ? { write: (chunk: string) => (chunks.push(chunk), true) }
    : targetStdout;
  await runAxiCli<TeamContext>({
    argv: parsed.argv,
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    stdout: runtimeStdout,
    home: withTeamContext(async () => homeCommand()),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    resolveContext: ({ args }) => {
      try {
        const { teamKey } = parseTeamArgs(args);
        return teamKey ? { teamKey } : {};
      } catch {
        // Command handlers parse the same context through withTeamContext().
        // Let that path surface a structured CLI error rather than throwing
        // before runAxiCli's error boundary is active.
        return {};
      }
    },
  });
  if (parsed.format === "json") {
    targetStdout.write(`${jsonOutput(chunks.join(""), parsed.argv, Number(process.exitCode ?? 0))}\n`);
  }
}
