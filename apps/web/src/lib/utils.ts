import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names, with Tailwind conflicts resolved.
 *
 * The shadcn convention: `clsx` flattens the conditional/array/object forms into one string, and
 * `tailwind-merge` then drops any earlier utility that a later one overrides - so
 * `cn('p-2', 'p-4')` is `p-4` rather than both, which is what makes a `className` prop passed from
 * a caller actually win over a component's own defaults. Pasted shadcn components import this as
 * `@/lib/utils`; nothing in Reflick's own CSS-Modules code needs it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
