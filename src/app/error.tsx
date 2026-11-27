"use client";

import { Button } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";
import { BROKE_BODY, BROKE_TITLE, digestOf } from "@/lib/broken";

/* `retry` reads the page again; `reset` only draws the same failed answer. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <StatusPage
      title={BROKE_TITLE}
      digest={digestOf(error)}
      action={<Button onClick={() => retry()}>Try again</Button>}
    >
      {BROKE_BODY}
    </StatusPage>
  );
}
