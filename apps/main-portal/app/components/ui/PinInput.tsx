"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/app/lib/cn";

// Fixed-length numeric code entry (TOTP).
//
// Real inputs, one per digit, rather than one field styled to look like several:
// password managers and iOS/Android SMS autofill target `autoComplete="one-time-code"`
// on an input, and a faked grid gets none of that.
//
// Paste is handled explicitly because the common case is pasting all six digits
// at once — without it, only the first box would fill.

/**
 * Is this value a finished code?
 *
 * Length alone is NOT the test, and that mistake made every code look invalid
 * for anyone who did not start in the first box. Boxes are positional, so a gap
 * has to be held open by something: `setDigit` pads with spaces. Tap the second
 * box and type six digits — focus stops at the last box, so five digits land and
 * box one stays empty — and the value is `" 07410"`. That is six characters, so
 * the old length check declared it complete and submitted it; the server strips
 * non-digits, sees FIVE, and rejects it out of hand. The error path then clears
 * the field, so doing the same thing again fails the same way, forever, with
 * "Code ist ungültig" on screen and a perfectly good authenticator in hand.
 *
 * Exported because the submit buttons must apply exactly this predicate too —
 * otherwise auto-submit is fixed while pressing the button still sends the gap.
 */
export function isPinComplete(value: string, length = 6): boolean {
  return value.length === length && /^\d+$/.test(value);
}

/**
 * The digit shown in one box, or nothing.
 *
 * The padding a gap leaves behind is a real character, and rendering it puts a
 * space inside an input that reads as empty. It looks fine and behaves badly:
 * `Backspace` on that box sees a truthy `value[index]` and refuses to step back,
 * so the box before the gap becomes unreachable by keyboard.
 */
function digitAt(value: string, index: number): string {
  const char = value[index] ?? "";
  return /\d/.test(char) ? char : "";
}

export function PinInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  label,
}: {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const commit = (next: string) => {
    onChange(next);
    // Every box filled with an actual digit — never merely "six characters
    // long", which a padded gap also satisfies. See isPinComplete().
    if (isPinComplete(next, length)) onComplete?.(next);
  };

  const setDigit = (index: number, digit: string) => {
    const chars = value.padEnd(length, " ").split("");
    chars[index] = digit;
    const next = chars.join("").replace(/\s+$/, "").trimEnd();
    commit(next.slice(0, length));
    if (digit && index < length - 1) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digitAt(value, index) && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < length - 1) refs.current[index + 1]?.focus();
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!digits) return;
    event.preventDefault();
    commit(digits);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label={label}>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={digitAt(value, index)}
          onChange={(event) => setDigit(index, event.currentTarget.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={onPaste}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`${label} – Ziffer ${index + 1}`}
          className={cn(
            "well readout size-12 text-center text-lg outline-none transition-colors",
            "focus:border-accent disabled:opacity-50",
          )}
        />
      ))}
    </div>
  );
}
