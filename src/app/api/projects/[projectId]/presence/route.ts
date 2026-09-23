import { body, clientIdOf, guard, humanOnly, json, readId, route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { publish } from "@/lib/events";
import { readClientId } from "@/lib/presence";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Says which task this tab has open, or that it has none.
 *
 * The server only relays: nothing is stored, nothing goes in the activity
 * feed, and nothing is read back. Every other tab on the project hears it on
 * the stream as `presence` and keeps its own room. A lost message corrects
 * itself, because a tab says it again every 25 seconds while a task is open.
 *
 * A person only. An agent already shows what it does through its run.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const clientId = readClientId(clientIdOf(req));
  if (!clientId) throw new HttpError(400, "Send the tab's id in the x-ushabti-client header.");

  const input = await body<{ taskId?: unknown; field?: unknown }>(req);
  const taskId = input.taskId == null ? null : readId(input.taskId, "task");
  if (input.field != null && (typeof input.field !== "string" || input.field.length > 100)) {
    throw new HttpError(400, "The field must be a short string, or null.");
  }
  const field = taskId && typeof input.field === "string" ? input.field : null;

  await publish({ projectId, kind: "presence", clientId, userId: user.id, taskId, field });
  return json({ ok: true });
});
