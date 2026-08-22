import { destroySession } from "@/lib/auth";
import { json, route } from "@/lib/api";

export const POST = route(async () => {
  await destroySession();
  return json({ ok: true });
});
