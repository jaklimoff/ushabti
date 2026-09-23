import { HttpError } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { countPropertyValues, propertyProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ propertyId: string }> };

/**
 * How many tasks hold a value for this property, archived ones included.
 *
 * It is the number the delete row names, and it is asked when that row is
 * pressed. It used to ride on every board read, so the daily read paid for a
 * number the owner reads once a month.
 *
 * Any member may ask. Deleting the property is an admin's, but a count hands
 * out no access and says nothing a member cannot count off the board itself,
 * so an agent may call it too.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  await guard(projectId);

  return json({ values: await countPropertyValues(propertyId) });
});
