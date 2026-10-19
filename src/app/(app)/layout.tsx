import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { listsOf } from "@/lib/lists-load";
import { listProjectsNow } from "@/lib/queries";
import { FOLD_COOKIE, readFolded } from "@/lib/sidebar";
import { Sidebar } from "@/components/ui/Sidebar";
import { SidebarProvider } from "@/components/ui/SidebarProvider";
import styles from "@/components/ui/Sidebar.module.css";

export const dynamic = "force-dynamic";

/**
 * Every signed-in page hangs in this one frame, with the sidebar on its left.
 * Next does not draw a layout again on navigation, so the sidebar and its
 * stream outlive each page. The fold is read here, from the cookie, so the
 * first paint already has it right and the board never jumps.
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  /* The page sends a stranger to sign in. */
  if (!user) return children;
  const [projects, lists, jar] = await Promise.all([
    listProjectsNow(user.id),
    listsOf(user.id),
    cookies(),
  ]);
  return (
    <SidebarProvider
      projects={projects}
      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
      folded={readFolded(jar.get(FOLD_COOKIE)?.value)}
    >
      <div className={styles.frame}>
        <Sidebar />
        <div className={styles.page}>{children}</div>
      </div>
    </SidebarProvider>
  );
}
