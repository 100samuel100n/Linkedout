"use client";
import { useId } from "react";

// Labelled form control with help and error text wired for screen readers.
export default function Field({ label, help, error, children, as = "input", style, ...props }) {
  const id = useId();
  const Control = as;
  return (
    <div style={style}>
      {label && <label className="lo-label" htmlFor={id}>{label}</label>}
      {children || <Control id={id} className="lo-field" aria-invalid={!!error || undefined} aria-describedby={error || help ? `${id}-d` : undefined} {...props} />}
      {(error || help) && <div id={`${id}-d`} className="lo-help" style={error ? { color: "var(--lo-flag)" } : undefined}>{error || help}</div>}
    </div>
  );
}
