import { HttpError, requireActor, requireMembership } from "@/lib/auth";
import { agentOnly, json, route } from "@/lib/api";
import { agentProject } from "@/lib/queries";
import { actsOff, AGENT_ACT_WORDS } from "@/lib/roles";

/**
 * The first call an agent makes. It answers "who am I and which board am I
 * on", so nothing else needs the project id in its configuration. It also
 * names the acts an admin switched off for it on this board, so a
 * well-behaved agent does not try them.
 */
export const GET = route(async () => {
  const actor = await requireActor();
  agentOnly(actor);
  const projectId = actor.tokenProjectId;
  if (!projectId) throw new HttpError(401, "That token is not valid any more.");

  const membership = await requireMembership(actor.id, projectId);
  const project = await agentProject(projectId);

  return json({
    agent: { id: actor.id, name: actor.name, color: actor.color, emoji: actor.emoji },
    project: {
      id: project.id,
      name: project.name,
      key: project.key,
      role: membership.role,
      waiting: project.waiting,
      off: actsOff(membership.acts).map((act) => ({ act, words: AGENT_ACT_WORDS[act].verb })),
    },
  });
});
