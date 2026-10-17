import { requireUser } from "@/lib/auth";
import { body, json, route, str } from "@/lib/api";
import { listPersonalTokens, makePersonalToken, readExpiry } from "@/lib/personal-tokens";

/*
 * Your personal tokens. Sign-in only, all three ways: a token that could make
 * a token could outlive its own revoking.
 */

export const GET = route(async () => {
  const user = await requireUser();
  return json({ tokens: await listPersonalTokens(user.id) });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const input = await body<{ name?: unknown; days?: unknown }>(req);
  const name = str(input.name, "Token name", { max: 80 });
  const days = readExpiry(input.days);
  const { token, secret } = await makePersonalToken(user.id, name, days);
  return json({ token, secret }, 201);
});
