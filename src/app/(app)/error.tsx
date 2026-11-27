"use client";

import { Button } from "@/components/ui/Button";
import { EmptyState, PageShell } from "@/components/ui/Layout";
import { BROKE_BODY, BROKE_TITLE, digestOf } from "@/lib/broken";

/*
 * A signed-in page broke. This boundary sits inside the frame, so the sidebar
 * and the tab's one stream stay standing while the page column says so.
 */
export default function SignedInError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  return (
    <PageShell width="narrow">
      <EmptyState
        title={BROKE_TITLE}
        mark="!"
        action={<Button onClick={() => retry()}>Try again</Button>}
      >
        {BROKE_BODY}
        {digest && (
          <>
            {" "}
            Look for <code>{digest}</code> in the server log.
          </>
        )}
      </EmptyState>
    </PageShell>
  );
}
