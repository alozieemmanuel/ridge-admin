"use client";

import Link from "next/link";
import { ShellFrame } from "@/components/AdminShell";
import { useEvent } from "@/lib/useEvent";
import { ghostButton } from "@/components/ui";

/**
 * The sidebar frame of one event. It is built once here, so moving between the event's pages only swaps the content on the right.
 * An event that doesn't exist, or that this admin wasn't added to, shows a short message instead of the pages.
 */
export default function EventLayout({ children }: { children: React.ReactNode }) {
  const { denied } = useEvent();
  return (
    <ShellFrame>
      {denied ? (
        <div className="max-w-md py-16">
          <h1 className="font-serif text-3xl mb-3">You can't open this event</h1>
          <p className="text-muted mb-6">It doesn't exist, or you haven't been added to it. Ask an owner to give you access.</p>
          <Link href="/" className={ghostButton}>
            Back to all events
          </Link>
        </div>
      ) : (
        children
      )}
    </ShellFrame>
  );
}
