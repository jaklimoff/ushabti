"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { Avatar } from "./Avatar";
import { useDismiss } from "./useDismiss";
import styles from "./UserMenu.module.css";

export type SessionUser = { id: string; name: string; email: string; color: string };

export function UserMenu({ user, extra }: { user: SessionUser; extra?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);

  async function signOut() {
    await api.post("/api/auth/logout");
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button className={styles.button} onClick={() => setOpen((v) => !v)}>
        <Avatar name={user.name} color={user.color} size={20} />
        <span className={styles.name}>{user.name}</span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menu}>
          <div className={styles.email}>{user.email}</div>
          {extra}
          <Link className={styles.item} href="/projects" onClick={() => setOpen(false)}>
            All projects
          </Link>
          <button className={styles.item} onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
