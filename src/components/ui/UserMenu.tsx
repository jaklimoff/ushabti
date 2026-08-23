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
      <button
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} color={user.color} size={20} />
        <span className={styles.name}>{user.name}</span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.email}>{user.email}</div>
          {extra}
          <Link
            className={styles.item}
            role="menuitem"
            href="/account"
            onClick={() => setOpen(false)}
          >
            Account
          </Link>
          <Link
            className={styles.item}
            role="menuitem"
            href="/projects"
            onClick={() => setOpen(false)}
          >
            All projects
          </Link>
          <div className={styles.rule} />
          <button className={styles.item} role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
