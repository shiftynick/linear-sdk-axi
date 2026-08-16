import { assertNoUnknownFlags } from "../args.js";
import { getViewer, getViewerOrganization, listTeams } from "../linear.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const DOCTOR_HELP = `usage: linear-axi doctor
Verify Linear authentication and report read-only workspace access.

flags: --help
examples:
  linear-axi doctor
`;

const teamSchema: FieldDef[] = [field("key"), field("name")];

export async function doctorCommand(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, [], "doctor");

  const viewer = await getViewer();
  const [organization, teams] = await Promise.all([
    getViewerOrganization(viewer),
    listTeams(100),
  ]);

  return renderOutput([
    renderDetail(
      "doctor",
      {
        status: "ok",
        authentication: "verified",
        viewer: viewer.name ?? viewer.displayName ?? viewer.email ?? null,
        viewerEmail: viewer.email ?? null,
        workspace: organization?.name ?? "unknown",
        workspaceUrlKey: organization?.urlKey ?? null,
        accessibleTeamCount: teams.length,
      },
      [
        field("status"),
        field("authentication"),
        field("viewer"),
        field("viewerEmail"),
        field("workspace"),
        field("workspaceUrlKey"),
        field("accessibleTeamCount"),
      ],
    ),
    renderList(
      "teams",
      teams.map((team) => ({
        key: team.key ?? null,
        name: team.name ?? null,
      })),
      teamSchema,
      "0 accessible teams",
    ),
    renderHelp([
      "Authentication verified with read-only Linear calls",
      "Run `linear-axi status --team <key>` to inspect a team's workflow states",
    ]),
  ]);
}
