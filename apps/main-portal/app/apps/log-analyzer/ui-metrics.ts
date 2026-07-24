// Layout constants shared by the log-analyzer views.
//
// Mantine sizes its inputs through a component-scoped CSS variable, so a
// skeleton that stands in for one has no variable to inherit — it needs the
// number. Keeping it here means the placeholder and the real control can never
// drift apart and reintroduce a layout shift on load.

/** Height of a Mantine `size="xs"` input (Select/TextInput), in px. */
export const XS_INPUT_HEIGHT = 30;
