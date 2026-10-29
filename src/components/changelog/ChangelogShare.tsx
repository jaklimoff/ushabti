"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { Button, ButtonPageLink } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Layout";

/**
 * Whether strangers read this changelog, said where the changelog is. It used
 * to live only in Settings, so a member sharing a release had to go there to
 * learn the page was public, and to find its address.
 *
 * A private changelog says nothing to a member, who cannot change it; an
 * admin is offered the way to the switch. Nothing here flips it: the switch
 * stays in Settings, beside what it costs.
 */
export function ChangelogShare({
  path,
  isPublic,
  settingsHref,
}: {
  /** The public address, without the origin. */
  path: string;
  isPublic: boolean;
  /** Where an admin turns it on, or null for somebody who cannot. */
  settingsHref: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!isPublic) {
    return settingsHref ? (
      <ButtonPageLink variant="text" href={settingsHref} data-testid="changelog-share">
        Share…
      </ButtonPageLink>
    ) : null;
  }

  async function copy() {
    if (!(await copyText(`${window.location.origin}${path}`))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <Tag accent title={`Anyone with ${path} reads it`}>
        Public
      </Tag>
      <Button variant="text" data-testid="changelog-copy" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy address"}
      </Button>
    </>
  );
}
