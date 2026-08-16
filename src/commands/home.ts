import { encode } from "@toon-format/toon";
import { formatCountLine } from "../format.js";
import {
  countByStateType,
  getAssignedIssues,
  getViewer,
  hydrateIssue,
} from "../linear.js";
import {
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

const HOME_DISPLAY_LIMIT = 20;
const HOME_FETCH_LIMIT = 100;

const issueSchema: FieldDef[] = [
  field("identifier"),
  field("title"),
  field("state"),
  field("team"),
];

export async function homeCommand(): Promise<string> {
  const me = await getViewer();
  const assigned = await getAssignedIssues({ first: HOME_FETCH_LIMIT });
  const hydrated = await Promise.all(assigned.nodes.map(hydrateIssue));
  const displayed = hydrated.slice(0, HOME_DISPLAY_LIMIT);
  const stateCounts = countByStateType(hydrated);
  const total = assigned.totalCount;

  const blocks: string[] = [
    encode({
      me: {
        id: me.id ?? null,
        name: me.name ?? me.displayName ?? null,
        email: me.email ?? null,
      },
    }),
    formatCountLine({
      count: displayed.length,
      limit: HOME_DISPLAY_LIMIT,
      totalCount: total,
    }),
    renderList(
      "issues",
      displayed,
      issueSchema,
      "0 assigned issues",
    ),
    encode({
      counts: {
        assigned: total,
        ...stateCounts,
      },
    }),
    renderHelp([
      "Run `linear-axi issue view <id>` for details",
      "Run `linear-axi issue list --team <key>` to list a team",
      "Run `linear-axi setup hooks` to install session hooks",
    ]),
  ];

  return renderOutput(blocks);
}
