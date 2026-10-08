import type { AnchorHTMLAttributes } from "react";

/* A plain anchor, because a test never follows the link: it only reads it. */
export default function Link({
  href,
  prefetch: _prefetch,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return <a href={href} {...rest} />;
}
