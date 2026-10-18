"use client";

import { Button } from "@/components/ui/Button";
import { StatusPage } from "@/components/ui/StatusPage";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPage
      title="Something broke"
      digest={error.digest}
      action={<Button onClick={reset}>Try again</Button>}
    >
      The page could not finish loading. Try again; if it keeps happening, look at the server log.
    </StatusPage>
  );
}
