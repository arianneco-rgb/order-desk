import clsx from "clsx";

/** Small inline keyboard-key badge, e.g. <Kbd>⌘</Kbd><Kbd>Enter</Kbd>. */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={clsx(
        "inline-flex items-center justify-center rounded border border-forest-300 bg-forest-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-forest-700 shadow-sm",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/** True on macOS — controls whether hints show ⌘ or Ctrl. Client-only. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
