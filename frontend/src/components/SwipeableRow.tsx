import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";

/** iOS-style swipeable list row: swipe left to reveal action buttons,
 * tap to trigger onTap (tap also closes an open row). */
export function SwipeableRow({
  actions,
  actionsWidth = 150,
  onTap,
  children,
}: {
  actions: (close: () => void) => ReactNode;
  actionsWidth?: number;
  onTap?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative overflow-hidden border-t border-border first:border-t-0">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: actionsWidth }}>
        {actions(() => setOpen(false))}
      </div>
      <motion.div
        className="relative bg-card"
        drag="x"
        dragConstraints={{ left: -actionsWidth, right: 0 }}
        dragElastic={0.06}
        animate={{ x: open ? -actionsWidth : 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        style={{ touchAction: "pan-y" }}
        onDragEnd={(_, info) => {
          if (open) {
            if (info.offset.x > 40 || info.velocity.x > 300) setOpen(false);
          } else if (info.offset.x < -40 || info.velocity.x < -300) {
            setOpen(true);
          }
        }}
        onTap={() => (open ? setOpen(false) : onTap?.())}
      >
        {children}
      </motion.div>
    </div>
  );
}
