import type { AnchorHTMLAttributes } from "react";

/* A plain anchor, because a test never follows the link: it only reads it. */
export default function Link({
  href,
  prefetch: _prefetch,
  scroll: _scroll,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean;
  scroll?: boolean;
}) {
  return <a href={href} {...rest} />;
}
