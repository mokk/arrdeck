import type { ReactNode } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

/** Bottom sheet on shadcn's Drawer (vaul) — swipe down to dismiss. */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="mx-auto max-h-[88vh] max-w-xl border-border bg-card">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="text-base leading-snug">{title}</DrawerTitle>
          {subtitle && (
            <DrawerDescription className="break-words text-xs">{subtitle}</DrawerDescription>
          )}
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
