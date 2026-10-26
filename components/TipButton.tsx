"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
};

export function TipButton({ label, className, disabled, pressed, onClick, children }: Props) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  const timer = useRef(0);
  const hostRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const tip = tipRef.current;
    if (!open || !host || !tip) return;
    const hostBox = host.getBoundingClientRect();
    const width = tip.offsetWidth;
    let next = hostBox.width / 2 - width / 2;
    const absLeft = hostBox.left + next;
    if (absLeft < 8) next += 8 - absLeft;
    const absRight = hostBox.left + next + width;
    if (absRight > window.innerWidth - 8) next -= absRight - (window.innerWidth - 8);
    setLeft(next);
  }, [open, label]);

  return (
    <span
      ref={hostRef}
      className="tip"
      onMouseEnter={() => {
        timer.current = window.setTimeout(() => setOpen(true), 200);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setOpen(false);
      }}
    >
      <button type="button" className={className} disabled={disabled} aria-pressed={pressed} aria-label={label} onClick={onClick}>
        {children}
      </button>
      {open ? (
        <span ref={tipRef} role="tooltip" style={{ left }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
