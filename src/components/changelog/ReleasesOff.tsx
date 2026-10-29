import { ButtonPageLink } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Layout";
import { propertySettingsHref } from "@/lib/board-roles";
import { canManage } from "@/lib/roles";

/**
 * The changelog of a project with releases off. It is a way forward, not a
 * wall: it says what the page is for, and who can turn releases on. They are
 * turned on on Properties, which only an owner or an admin can change, so a
 * member is told who to ask rather than handed a page that refuses them.
 */
export function ReleasesOff({ projectId, role }: { projectId: string; role: string }) {
  return (
    <Card>
      <EmptyState
        title="Releases are off"
        action={
          canManage(role) ? (
            <ButtonPageLink
              variant="ghost"
              href={propertySettingsHref(projectId)}
              data-testid="changelog-turn-on"
            >
              Turn on releases in Settings
            </ButtonPageLink>
          ) : (
            "An admin turns them on in Settings → Properties."
          )
        }
      >
        A changelog lists each release that shipped, with its note and its tasks. Turn releases on
        once and every ship lands here.
      </EmptyState>
    </Card>
  );
}
