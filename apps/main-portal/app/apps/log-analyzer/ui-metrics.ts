// Layout constants shared by the log-analyzer views.
//
// A skeleton standing in for a form control has to be exactly as tall as the
// control, or the swap shifts the page — the CLS specs in e2e/log-analyzer.spec
// assert precisely that. Keeping the number here means the placeholder and the
// real control cannot drift apart.

/**
 * Height of a form control (Select/TextInput) in px, matching `Field`'s
 * `h-11 sm:h-10`.
 *
 * The phone value is the one that matters: the CLS specs run on Pixel 5, below
 * the `sm` breakpoint, so the control is 44px there. 44 is also the WCAG 2.5.5
 * thumb-target minimum, which is why the control is that tall in the first place.
 */
export const CONTROL_HEIGHT_MOBILE = 44;
export const CONTROL_HEIGHT_DESKTOP = 40;

/**
 * Tailwind classes for a control-sized skeleton. Preferred over the raw numbers:
 * one class string tracks both breakpoints, so a change to `Field` only has to
 * be mirrored here once.
 */
export const CONTROL_SKELETON_CLASS = "h-11 w-full sm:h-10";

/** @deprecated Use {@link CONTROL_SKELETON_CLASS}. Kept for the dyno view until it migrates. */
export const XS_INPUT_HEIGHT = CONTROL_HEIGHT_MOBILE;
