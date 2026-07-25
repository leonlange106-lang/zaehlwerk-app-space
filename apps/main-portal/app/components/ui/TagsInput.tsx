"use client";

import { useState, type KeyboardEvent } from "react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/app/lib/cn";

// Free-form tag editing: type, press Enter or comma to commit, Backspace on an
// empty field removes the last one.
//
// Each committed tag is a real <button>, not a div with a click handler, so the
// whole set is reachable by keyboard — a tag you can add but not remove without
// a mouse is a trap. The list is announced through the input's own label.

export function TagsInput({
  value,
  onChange,
  placeholder = "Tag hinzufügen…",
  id,
  className,
  "data-testid": testId,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const tag = raw.trim();
    // Silently ignore duplicates rather than erroring: re-typing a tag that is
    // already there is a no-op in the user's head, so it should be one here.
    if (!tag || value.includes(tag)) {
      setDraft("");
      return;
    }
    onChange([...value, tag]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      data-testid={testId}
      className={cn(
        "well flex min-h-11 flex-wrap items-center gap-1.5 px-2 py-1.5 sm:min-h-10",
        "focus-within:border-accent",
        className,
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-elevated py-0.5 pl-2.5 pr-1 text-[12px]"
        >
          {tag}
          <button
            type="button"
            aria-label={`Tag „${tag}" entfernen`}
            onClick={() => onChange(value.filter((candidate) => candidate !== tag))}
            className="grid size-5 place-items-center rounded-full text-dim transition-colors hover:bg-canvas hover:text-ink"
          >
            <IconX size={12} stroke={2.4} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        // Committing on blur too: leaving the field with typed text and finding
        // it gone is the most common complaint about this control.
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-24 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-dim"
      />
    </div>
  );
}
