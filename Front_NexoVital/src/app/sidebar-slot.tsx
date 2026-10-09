import { createContext, type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Sidebar node: undefined without a shell, null until the shell mounts it. */
const SidebarSlotContext = createContext<HTMLElement | null | undefined>(undefined);

export const SidebarSlotProvider = SidebarSlotContext.Provider;

/** Renders its children in the shell sidebar; inline when there is no shell. */
export function SidebarSlot({ children }: { children: ReactNode }) {
  const target = useContext(SidebarSlotContext);
  if (target === undefined) {
    return children;
  }
  if (target === null) {
    return null;
  }
  return createPortal(children, target);
}
