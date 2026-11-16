import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

import { MessageMarkdown } from "../../chat/message-markdown";

/**
 * A brief or follow-up sent to a Task, on the right like a Room message. A
 * long one folds to its first few lines so the AlterEgo's work stays in view.
 */
export function TaskInputBubble({
  authorKind,
  body,
}: {
  authorKind: "agent" | "human";
  body: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node || expanded) return;
    const measure = () => setClipped(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [body, expanded]);
  return (
    <div className="flex justify-end">
      {/* The bubble's own max-width outranks a width utility on it. */}
      <div className="min-w-0 max-w-[85%]">
        <div className="room-message-bubble">
          <div
            className={cn(
              !expanded && "max-h-[110px] overflow-hidden",
              !expanded &&
                clipped &&
                "[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]",
            )}
            ref={content}
          >
            <MessageMarkdown authorKind={authorKind} body={body} />
          </div>
          {clipped || expanded ? (
            <button
              aria-expanded={expanded}
              className="-mx-1 mt-1 inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              {expanded ? "Show less" : "Show more"}
              <Icon
                className={cn(
                  "transition-transform duration-150",
                  expanded && "rotate-180",
                )}
                icon={ArrowDown01Icon}
                size={14}
              />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
