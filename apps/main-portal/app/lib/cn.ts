import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose class names, letting a later class win over an earlier one of the same
 * Tailwind group (`twMerge`) instead of both landing in the DOM and the cascade
 * deciding by rule order. That is what makes a component's `className` prop a
 * real override rather than a coin flip.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
