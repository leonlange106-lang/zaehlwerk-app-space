"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconChartHistogram,
  IconGauge,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { Spinner } from "@/app/components/ui/primitives";
import { isSearchable, type SearchHit, type SearchKind } from "@/app/lib/search-match";
import { cn } from "@/app/lib/cn";

// The header search, which until now was a text field wired to nothing.
//
// It looked like a feature and did nothing, which is worse than not having it —
// so this either works or it should not be on screen.
//
// Three things it must get right, none of them about the query itself:
//
//   1. **Present at every width.** The old field was `hidden sm:block`, so the
//      phone — the device this app is designed for first — had no search at all.
//      Below `sm` the field collapses to an icon that opens a full-width sheet;
//      the input is the same element either way.
//   2. **Reserved geometry.** The panel is `position: fixed`/absolute and never
//      pushes layout, so results arriving cannot shift the page under a thumb.
//   3. **Keyboard-complete.** ↑/↓ move, Enter opens, Escape closes and returns
//      focus to the field. A search you can only use with a mouse is a search
//      the keyboard user is locked out of.

const KIND_ICON: Record<SearchKind, typeof IconSearch> = {
  meter: IconGauge,
  log: IconChartHistogram,
  settings: IconSettings,
  page: IconSearch,
};

const KIND_LABEL: Record<SearchKind, string> = {
  meter: "Zähler",
  log: "Log",
  settings: "Einstellungen",
  page: "Seite",
};

/** Long enough that typing does not fire a request per keystroke, short enough
 *  that the list feels attached to the keyboard. */
const DEBOUNCE_MS = 180;

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** Phone only: the field is an icon until this is set. */
  const [expanded, setExpanded] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
  }, []);

  const searchable = isSearchable(query);
  // Derived, not stored. Clearing `hits` from the effect when the query gets too
  // short would be state React can compute itself, and it costs a second render
  // pass on every keystroke that empties the field.
  const visibleHits = searchable ? hits : [];

  // Fetch, debounced, with the in-flight request abandoned when the term moves
  // on — otherwise a slow early response can land after a fast later one and
  // overwrite the results for what is now the wrong query.
  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      // Inside the timer, not in the effect body: a query abandoned within the
      // debounce window never shows a spinner at all.
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { hits: SearchHit[] };
        setHits(body.hits);
        setActive(0);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setHits([]);
      } finally {
        // The abort path must not clear the spinner: a newer request is already
        // running and owns it.
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchable]);

  // Close on an outside click. Pointerdown rather than click, so a tap that
  // starts outside does not first activate something inside.
  useEffect(() => {
    if (!open && !expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, expanded, close]);

  const go = useCallback(
    (hit: SearchHit) => {
      close();
      setQuery("");
      router.push(hit.href);
    },
    [router, close],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      inputRef.current?.blur();
      return;
    }
    if (!visibleHits.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % visibleHits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + visibleHits.length) % visibleHits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = visibleHits[active];
      if (hit) go(hit);
    }
  };

  const showPanel = open && searchable;

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex min-w-0 items-center",
        // Expanded on a phone the field lies OVER the header rather than inside
        // its flex row. Sharing the row leaves it about 100px on a 390px screen
        // — the menu, the brand and three round buttons are all `flex-none` and
        // take their width first — which is not a field anyone can read a query
        // in. The header is `fixed`, so it is the containing block here.
        expanded
          ? "absolute inset-x-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-surface"
          : "relative",
      )}
    >
      {/* Phone: an icon that opens the field. Above `sm` the field is always
          there, so this button is not rendered at all rather than merely
          hidden — a button that cannot be reached should not be in the tree. */}
      {!expanded && (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            setOpen(true);
            // The input mounts in the same commit; focus after paint.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label="Suchen"
          className="flex size-11 flex-none items-center justify-center rounded-full text-dim transition-colors hover:bg-elevated hover:text-ink sm:hidden"
        >
          <IconSearch size={18} stroke={1.6} />
        </button>
      )}

      <label
        className={cn(
          "relative",
          // Expanded on a phone the field takes the header's full width, which is
          // why the header lets this element grow.
          expanded ? "block w-full" : "hidden sm:block",
        )}
      >
        <span className="sr-only">Suchen</span>
        <IconSearch
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim"
        />
        <input
          ref={inputRef}
          type="search"
          placeholder="Suchen…"
          value={query}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          data-testid="global-search"
          className={cn(
            "well h-11 rounded-full pl-9 pr-9 text-[13px] outline-none placeholder:text-dim focus:border-accent sm:h-9",
            expanded ? "w-full" : "w-[min(340px,26vw)]",
          )}
        />
        {searchable && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {loading ? (
              <Spinner size={13} label="Suche läuft" className="text-dim" />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Suche leeren"
                className="flex size-5 items-center justify-center rounded-full text-dim hover:text-ink"
              >
                <IconX size={14} />
              </button>
            )}
          </span>
        )}
      </label>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          aria-label="Suchergebnisse"
          data-testid="search-results"
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 max-h-[min(70vh,26rem)] overflow-y-auto",
            "rounded-panel border border-line bg-elevated/95 p-1.5 shadow-panel-lg backdrop-blur-xl",
            "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150",
            // Anchored to the right so it cannot push the header sideways, and
            // capped at the viewport so a phone never scrolls horizontally.
            "right-0 w-[min(88vw,26rem)]",
          )}
        >
          {visibleHits.length === 0 && !loading && (
            <p className="px-3 py-4 text-[13px] text-dim">
              Nichts gefunden für „{query}“.
            </p>
          )}
          {visibleHits.map((hit, index) => (
            <HitRow
              key={`${hit.kind}:${hit.id}`}
              hit={hit}
              active={index === active}
              onPick={() => go(hit)}
              onHover={() => setActive(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HitRow({
  hit,
  active,
  onPick,
  onHover,
}: {
  hit: SearchHit;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const Icon = KIND_ICON[hit.kind];
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left transition-colors",
        active ? "bg-canvas" : "hover:bg-canvas",
      )}
    >
      {hit.dot ? (
        <span
          aria-hidden
          className="size-2.5 flex-none rounded-full"
          style={{ background: hit.dot }}
        />
      ) : (
        <Icon size={16} stroke={1.7} className="flex-none text-dim" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13.5px]">{hit.title}</span>
        {hit.subtitle && <span className="truncate text-[11px] text-dim">{hit.subtitle}</span>}
      </span>
      <span className="legend-label ml-auto flex-none">{KIND_LABEL[hit.kind]}</span>
    </button>
  );
}
