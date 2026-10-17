import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/** Adds a person with an account from the People page, as the owner does. */
async function addMember(page: Page, email: string, name: string) {
  await page.getByLabel("Email of the new member").fill(email);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

/* What an admin and an agent may do is `people-route.test.ts`; the question
   before Make owner is `PeoplePanel.test.tsx`. */
test.describe("Roles", () => {
  test(
    "a member adds a property, an option and a type but deletes none; so does an agent",
    { tag: "@smoke" },
    async ({ page, browser }) => {
      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      const member = await register(memberPage, "Bob Member");

      await register(page, "Olga Owner");
      const projectId = await createProject(page, unique("Shape"));
      const made = await page.request.post(`/api/projects/${projectId}/properties`, {
        data: { name: "Type", type: "select", options: ["Bug", "Story"] },
      });
      expect(made.ok()).toBeTruthy();
      const { property: type } = (await made.json()) as {
        property: { id: string; options: { id: string }[] };
      };
      expect(
        (
          await page.request.patch(`/api/projects/${projectId}`, { data: { typeBy: type.id } })
        ).ok(),
      ).toBeTruthy();
      await gotoSettings(page, projectId, "people");
      await addMember(page, member.email, "Bob Member");
      await page.getByLabel("Name of the new agent").fill("Helper");
      await page.getByRole("button", { name: "Add agent" }).click();
      await page
        .getByTestId("agent-box")
        .filter({ hasText: "Helper" })
        .getByRole("button", { name: "Connect" })
        .click();
      await page.getByRole("button", { name: "Make token" }).click();
      const token = (
        (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
      ).trim();
      expect(token).toMatch(/^ush_/);

      /* ---- an agent adds a property, as a member may ------------------- */

      const bearer = { Authorization: `Bearer ${token}` };
      const agentMade = await memberPage.request.post(`/api/projects/${projectId}/properties`, {
        headers: bearer,
        data: { name: "Agent made", type: "select", options: ["One", "Two"] },
      });
      expect(agentMade.status()).toBe(201);
      const { property: madeByAgent } = (await agentMade.json()) as {
        property: { id: string; name: string; options: { id: string; name: string }[] };
      };
      expect(madeByAgent.options.map((o) => o.name)).toEqual(["One", "Two"]);
      const seen = await (
        await memberPage.request.get(`/api/projects/${projectId}/board`, { headers: bearer })
      ).json();
      expect(
        (seen.properties as { name: string }[]).some((p) => p.name === "Agent made"),
      ).toBeTruthy();

      /* ---- and deletes nothing, nor changes a property's shape ---------- */

      const asAgent = memberPage.request;
      const person = "Only a person can do this.";
      const view = (seen.views as { id: string }[])[0];
      for (const refused of [
        asAgent.delete(`/api/properties/${madeByAgent.id}`, { headers: bearer }),
        asAgent.delete(`/api/options/${madeByAgent.options[0].id}`, { headers: bearer }),
        asAgent.delete(`/api/views/${view.id}`, { headers: bearer }),
        ...[{ dated: true }, { cadence: { length: 14 } }, { when: null }, { defaults: {} }].map(
          (data) => asAgent.patch(`/api/properties/${madeByAgent.id}`, { headers: bearer, data }),
        ),
      ]) {
        const answer = await refused;
        expect(answer.status()).toBe(403);
        expect((await answer.json()).error).toBe(person);
      }

      /* ---- a member gets the same add buttons on both pages ------------- */

      await gotoSettings(memberPage, projectId, "properties");
      await expect(memberPage.getByRole("button", { name: "Add property" })).toBeVisible();
      await gotoSettings(memberPage, projectId, "types");
      await memberPage.getByLabel("New type name").fill("Chore");
      await memberPage.getByRole("button", { name: "Add type" }).click();
      await expect(memberPage.getByRole("group", { name: "Types" }).getByRole("button")).toHaveText(
        ["Bug", "Story", "Chore"],
      );
      const mine = await memberPage.request.post(`/api/projects/${projectId}/properties`, {
        data: { name: "Mine", type: "text" },
      });
      expect(mine.ok()).toBeTruthy();

      /* ---- and deletes nothing ------------------------------------------ */

      const as = memberPage.request;
      expect((await as.delete(`/api/properties/${(await mine.json()).property.id}`)).status()).toBe(
        403,
      );
      expect((await as.delete(`/api/properties/${type.id}`)).status()).toBe(403);
      // A type is an option of the Type select, so this is deleting a type too.
      expect((await as.delete(`/api/options/${type.options[0].id}`)).status()).toBe(403);
      const board = await (await as.get(`/api/projects/${projectId}/board`)).json();
      type Prop = { name: string; options: { name: string }[] };
      const props = board.properties as Prop[];
      expect(props.map((p) => p.name)).toEqual(expect.arrayContaining(["Type", "Mine"]));
      expect(props.find((p) => p.name === "Type")!.options.map((o) => o.name)).toEqual([
        "Bug",
        "Story",
        "Chore",
      ]);

      await memberContext.close();
    },
  );
});
