"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/Button";
import styles from "./AuthForm.module.css";

/**
 * The invite page for somebody signed in as the invited email. Joining is a
 * press, never the opening of the page: a link a mail scanner follows must
 * not put anybody in a project.
 */
export function JoinInvite({ token, project }: { token: string; project: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api.post<{ joined: string }>("/api/invites/accept", { token });
      router.replace(`/p/${answer.joined}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <Button size="xl" block type="submit" busy={busy} autoFocus>
          {busy ? "One moment…" : `Join ${project}`}
        </Button>
      </form>
    </>
  );
}
