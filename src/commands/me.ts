import { encode } from "@toon-format/toon";
import { assertNoUnknownFlags } from "../args.js";
import { getAssignedIssues, getViewer } from "../linear.js";
import { renderHelp, renderOutput } from "../toon.js";

export const ME_HELP = `usage: linear-sdk-axi me
Show the authenticated Linear viewer and assigned issue count.

flags: --help
examples:
  linear-sdk-axi me
`;

export async function meCommand(args: string[]): Promise<string> {
  assertNoUnknownFlags(args, [], "me");
  const me = await getViewer();
  const assigned = await getAssignedIssues({ first: 1 });
  return renderOutput([
    encode({
      me: {
        id: me.id ?? null,
        name: me.name ?? me.displayName ?? null,
        email: me.email ?? null,
        assignedIssueCount: assigned.totalCount,
      },
    }),
    renderHelp([
      "Run `linear-sdk-axi issue list` for assigned uncompleted issues",
      "Run `linear-sdk-axi` for the dashboard",
    ]),
  ]);
}
