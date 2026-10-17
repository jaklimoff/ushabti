import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/api";
import { revokePersonalToken } from "@/lib/personal-tokens";

type Ctx = { params: Promise<{ tokenId: string }> };

/** Revokes one of your tokens. The next request that carries it gets a 401. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { tokenId } = await ctx.params;
  const user = await requireUser();
  await revokePersonalToken(user.id, tokenId);
  return json({ ok: true });
});
