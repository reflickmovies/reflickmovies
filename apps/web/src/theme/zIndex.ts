/**
 * z-index values as CSS custom properties, so a component can read the scale
 * instead of hard-coding 999. Colours live in `theme/color`.
 */

export const zIndex = {
  base: 'var(--z-base, 0)',
  raised: 'var(--z-raised, 10)',
  sticky: 'var(--z-sticky, 100)',
  dropdown: 'var(--z-dropdown, 200)',
  overlay: 'var(--z-overlay, 300)',
  modal: 'var(--z-modal, 400)',
  toast: 'var(--z-toast, 500)',
} as const;

export type ZIndexToken = keyof typeof zIndex;

export const zIndexVariables = {
  '--z-base': '0',
  '--z-raised': '10',
  '--z-sticky': '100',
  '--z-dropdown': '200',
  '--z-overlay': '300',
  '--z-modal': '400',
  '--z-toast': '500',
} as const;