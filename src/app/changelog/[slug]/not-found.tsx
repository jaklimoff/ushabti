import { StatusPage } from "@/components/ui/StatusPage";

/**
 * The reader here is usually a stranger, with no projects and no teammate to
 * ask, so the members' 404 and its way to "your projects" say nothing to
 * them. A private changelog and no changelog read the same on purpose: the
 * loader keeps a stranger from telling the two apart, and so does this page.
 */
export default function ChangelogNotFound() {
  return (
    <StatusPage title="This changelog is not public" href="/login" hrefLabel="Sign in">
      The address may be wrong, or the project keeps its changelog to its members. A member reads it
      after signing in.
    </StatusPage>
  );
}
