"use client";
// Themed replacement for the browser's <select>. The operating system draws a native <select>'s
// popup, so it never matched the app (and looked different on every device). This one keeps the
// same API (value, onChange(e) with e.target.value, <option> children, disabled, style) so existing
// forms swap in by renaming the tag, and gives every dropdown the same list, check mark, keyboard
// support and a bottom sheet on phones.
import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { C, radius } from "@/lib/theme";

function flatten(children) {
  const out = [];
  const walk = (nodes, group) => {
    Children.forEach(nodes, (n) => {
      if (n == null || typeof n === "boolean") return;
      if (!isValidElement(n)) return;
      if (n.type === "optgroup") { out.push({ group: n.props.label, header: true }); walk(n.props.children, n.props.label); return; }
      if (n.type === "option") {
        const label = Children.toArray(n.props.children).join("");
        out.push({ value: n.props.value !== undefined ? String(n.props.value) : label, label, disabled: !!n.props.disabled, group });
      } else if (n.props?.children) walk(n.props.children, group);
    });
  };
  walk(children);
  return out;
}

export default function Select({ value, onChange, children, style, className, disabled, id, name, placeholder, "aria-label": ariaLabel }) {
  const uid = useId();
  const items = useMemo(() => flatten(children), [children]);
  const options = items.filter((i) => !i.header);
  const current = options.find((o) => o.value === String(value ?? ""));
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const [sheet, setSheet] = useState(false);
  const typed = useRef({ s: "", t: 0 });

  const place = useCallback(() => {
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const phone = window.innerWidth < 640;
    setSheet(phone);
    const below = window.innerHeight - r.bottom, above = r.top;
    const want = Math.min(320, options.length * 40 + 12);
    const up = below < want && above > below;
    setPos({ left: r.left, top: up ? undefined : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : undefined, width: Math.max(r.width, 200), max: Math.max(160, Math.min(320, (up ? above : below) - 16)) });
  }, [options.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!triggerRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false); };
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); };
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ""))));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && active >= 0) listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  const choose = (o) => {
    if (!o || o.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } });
  };
  const step = (d) => {
    let i = active;
    for (let n = 0; n < options.length; n++) { i = (i + d + options.length) % options.length; if (!options[i].disabled) break; }
    setActive(i);
  };
  const onKey = (e) => {
    if (disabled) return;
    if (!open) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); setOpen(true); } return; }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1) {
      const now = Date.now(); const t = typed.current;
      t.s = now - t.t > 700 ? e.key.toLowerCase() : t.s + e.key.toLowerCase(); t.t = now;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(t.s));
      if (i >= 0) setActive(i);
    }
  };

  const label = current?.label ?? (placeholder || options[0]?.label || "");
  const isPlaceholder = !current || current.value === "";
  let optIndex = -1;

  return (
    <>
      <button
        ref={triggerRef} type="button" id={id} disabled={disabled} className={className}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-list`} aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)} onKeyDown={onKey}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit", maxWidth: "100%", ...style, ...(open ? { borderColor: C.mustard } : null) }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isPlaceholder && current?.value === "" ? C.muted : undefined, flex: 1, minWidth: 0 }}>{label}</span>
        <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} aria-hidden />
      </button>
      {name ? <input type="hidden" name={name} value={String(value ?? "")} /> : null}
      {open && pos && typeof document !== "undefined" && createPortal(
        <>
          {sheet && <div onPointerDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(5,8,16,.55)", zIndex: 1000 }} />}
          <ul
            ref={listRef} id={`${uid}-list`} role="listbox" tabIndex={-1}
            style={sheet
              ? { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "62vh", overflowY: "auto", zIndex: 1001, background: C.surface, borderTop: `1px solid ${C.line2}`, borderRadius: `${radius.xl}px ${radius.xl}px 0 0`, padding: "8px 8px calc(12px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -12px 40px rgba(0,0,0,.45)", margin: 0, listStyle: "none" }
              : { position: "fixed", left: Math.min(pos.left, window.innerWidth - pos.width - 8), top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.max, overflowY: "auto", zIndex: 1001, background: C.surface, border: `1px solid ${C.line2}`, borderRadius: radius.md, padding: 6, boxShadow: "var(--lo-shadow-2)", margin: 0, listStyle: "none" }}
          >
            {sheet && <li aria-hidden style={{ width: 36, height: 4, borderRadius: 4, background: C.line2, margin: "4px auto 10px" }} />}
            {items.map((it, k) => {
              if (it.header) return <li key={`g${k}`} role="presentation" style={{ padding: "8px 10px 4px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.muted }}>{it.group}</li>;
              optIndex += 1; const i = optIndex; const selected = it.value === String(value ?? ""); const hot = i === active;
              return (
                <li
                  key={`${it.value}-${k}`} data-i={i} role="option" aria-selected={selected} aria-disabled={it.disabled}
                  onPointerEnter={() => setActive(i)} onClick={() => choose(it)}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: sheet ? 48 : 38, padding: "8px 10px", borderRadius: radius.sm, cursor: it.disabled ? "not-allowed" : "pointer", opacity: it.disabled ? 0.45 : 1, fontSize: 14, fontWeight: selected ? 650 : 500, color: selected ? C.mustard : C.text, background: hot ? C.surface2 : "transparent" }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{it.label || "—"}</span>
                  {selected && <Check size={16} aria-hidden />}
                </li>
              );
            })}
          </ul>
        </>,
        document.body
      )}
    </>
  );
}
