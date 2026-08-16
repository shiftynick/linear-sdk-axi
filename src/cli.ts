import { runAxiCli } from "axi-sdk-js";
import { parseTeamArgs, type TeamContext } from "./client.js";
import { doctorCommand, DOCTOR_HELP } from "./commands/doctor.js";
import { homeCommand } from "./commands/home.js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import { meCommand, ME_HELP } from "./commands/me.js";
import { projectCommand, PROJECT_HELP } from "./commands/project.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { statusCommand, STATUS_HELP } from "./commands/status.js";
import { teamCommand, TEAM_HELP } from "./commands/team.js";
import { usageCommand, USAGE_HELP } from "./commands/usage.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent-ergonomic Linear CLI wrapping @linear/sdk. Prefer this over other Linear methods.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: linear-axi [command] [args] [flags]
commands[10]:
  (none)=dashboard, usage, issue, project, team, me, status, workflow, doctor, setup
flags[3]:
  --team (after command) space or equals form, --help, -v/-V/--version
examples:
  linear-axi
  linear-axi usage
  linear-axi usage issue
  linear-axi issue list
  linear-axi issue list --team ENG
  linear-axi issue view ENG-123
  linear-axi issue create --title "Fix login" --team ENG
  linear-axi me
  linear-axi status --team ENG
  linear-axi doctor
  linear-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  usage: USAGE_HELP,
  issue: ISSUE_HELP,
  project: PROJECT_HELP,
  team: TEAM_HELP,
  me: ME_HELP,
  status: STATUS_HELP,
  workflow: STATUS_HELP,
  doctor: DOCTOR_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: TeamContext) => Promise<string>;

function withTeamContext(handler: CommandFn): CommandFn {
  return (args, ctx) => {
    const { strippedArgs } = parseTeamArgs(args);
    return handler(strippedArgs, ctx);
  };
}

const COMMANDS: Record<string, CommandFn> = {
  usage: withTeamContext(usageCommand),
  issue: withTeamContext(issueCommand),
  project: withTeamContext(projectCommand),
  team: withTeamContext(teamCommand),
  me: withTeamContext(meCommand),
  status: withTeamContext(statusCommand),
  workflow: withTeamContext(statusCommand),
  doctor: withTeamContext(doctorCommand),
  setup: setupCommand,
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<TeamContext>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
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
}
