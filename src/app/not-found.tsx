import { StatusPage } from "@/components/ui/StatusPage";

/**
 * This catches every 404, not only a project you are not in, so it leads with
 * the fact and keeps the useful guess second.
 */
export default function NotFound() {
  return (
    <StatusPage title="This page is not here">
      The link may be wrong, or what it pointed at may be gone. If a teammate sent it to you, ask
      them to add your email in the project settings.
    </StatusPage>
  );
}
