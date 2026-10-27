"use client";
import Link from "next/link";
import { Spinner } from "./Loading";

// variant: primary | secondary | ghost | danger   size: sm | md | lg
export default function Button({ variant = "primary", size = "md", loading = false, icon: Icon, href, children, disabled, className = "", style, ...rest }) {
  const cls = `lo-btn lo-btn-${variant} ${size === "sm" ? "lo-btn-sm" : size === "lg" ? "lo-btn-lg" : ""} ${className}`;
  const inner = <>{loading ? <Spinner size="sm" label="Working" /> : Icon ? <Icon size={size === "sm" ? 15 : 17} strokeWidth={2} /> : null}{children}</>;
  if (href && !disabled) return <Link href={href} className={cls} style={{ textDecoration: "none", ...style }} {...rest}>{inner}</Link>;
  return <button className={cls} disabled={disabled || loading} aria-busy={loading || undefined} style={style} {...rest}>{inner}</button>;
}
