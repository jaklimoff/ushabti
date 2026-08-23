"use client";

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
      action={
        <button
          onClick={reset}
          style={{
            padding: "6px 13px",
            borderRadius: "var(--r-sm)",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontSize: "var(--t-small)",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      }
    >
      The page could not finish loading. Try again; if it keeps happening, look at the server log.
    </StatusPage>
  );
}
