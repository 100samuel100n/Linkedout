"use client";
import { useEffect, useState } from "react";
import { C, displayFont, monoFont } from "@/lib/theme";

/* ---------- design tokens (all colours come from the app theme, so light and dark both work) ---------- */
const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 24 };
const muted = { color: C.muted, fontSize: 15, lineHeight: 1.65, margin: 0 };
const eyebrow = { color: C.mustard, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 };
const mono = { fontFamily: monoFont.fontFamily, fontSize: 12.5, wordBreak: "break-all", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", display: "block", marginTop: 6, color: C.text };
const btn = (primary) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 22px", borderRadius: 12, border: `1px solid ${primary ? C.mustard : C.line}`, background: primary ? C.mustard : "transparent", color: primary ? "#fff" : C.text, fontWeight: 700, fontSize: 15, textDecoration: "none", cursor: "pointer" });
const grid = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 16 });

/* ---------- canonical JSON + checks: identical to the algorithm in docs/DISTRIBUTION.md ---------- */
const canon = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}");
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function fingerprint(rawB64u) { const d = await crypto.subtle.digest("SHA-256", b64uToBytes(rawB64u)); return hex(d).toUpperCase().match(/.{1,4}/g).join(" "); }

/* ---------- small building blocks ---------- */
function Section({ id, kicker, title, lead, children }) {
  return (
    <section id={id} style={{ display: "grid", gap: 18, scrollMarginTop: 80 }}>
      <header style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        {kicker && <p style={eyebrow}>{kicker}</p>}
        <h2 style={{ ...displayFont, fontSize: 28, lineHeight: 1.2, margin: 0 }}>{title}</h2>
        {lead && <p style={{ ...muted, fontSize: 16 }}>{lead}</p>}
      </header>
      {children}
    </section>
  );
}
const Badge = ({ n }) => <span aria-hidden style={{ flex: "none", width: 28, height: 28, borderRadius: 999, background: C.surface2, border: `1px solid ${C.line}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: C.mustard }}>{n}</span>;
const Steps = ({ items }) => (
  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
    {items.map((t, i) => <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}><Badge n={i + 1} /><div style={{ ...muted, color: C.text, paddingTop: 3 }}>{t}</div></li>)}
  </ol>
);
const Pillar = ({ mark, title, children }) => (
  <article style={{ ...card, display: "grid", gap: 10, alignContent: "start" }}>
    <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: C.surface2, border: `1px solid ${C.line}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: C.mustard, fontSize: 15 }}>{mark}</span>
    <h3 style={{ ...displayFont, fontSize: 18, margin: 0 }}>{title}</h3>
    <p style={muted}>{children}</p>
  </article>
);

/* ---------- manifest + APK verifier ---------- */
function Verifier({ expected }) {
  const [r, setR] = useState(null), [busy, setBusy] = useState(false), [apk, setApk] = useState(null);
  async function checkManifest() {
    setBusy(true); setR(null); setApk(null);
    try {
      const env = await (await fetch("/.well-known/linkedout-distribution.json", { cache: "no-store" })).json();
      const pk = env.payload.signing.manifestPublicKey; const fp = await fingerprint(pk);
      let sigOk = null;
      try { const key = await crypto.subtle.importKey("raw", b64uToBytes(pk), { name: "Ed25519" }, false, ["verify"]); sigOk = await crypto.subtle.verify({ name: "Ed25519" }, key, b64uToBytes(env.signature), new TextEncoder().encode(canon(env.payload))); } catch { sigOk = null; }
      setR({ env, fp, sigOk, fresh: Date.parse(env.payload.expiresAt) > Date.now() });
    } catch { setR({ error: true }); } finally { setBusy(false); }
  }
  async function checkApk(e) {
    const f = e.target.files?.[0]; if (!f || !r?.env) return; setApk({ busy: true });
    const sum = hex(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()));
    const known = [r.env.payload.latest, ...(r.env.payload.releases || [])].filter(Boolean).find((x) => x.sha256 === sum);
    setApk({ sum, match: known ? `${known.versionName} (code ${known.versionCode})` : null });
  }
  const row = (label, ok, text) => <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}><b style={{ minWidth: 80, color: ok === null ? C.muted : ok ? C.green : C.flag, fontSize: 13 }}>{ok === null ? "UNKNOWN" : ok ? "PASS" : "FAIL"}</b><span style={{ ...muted, color: C.text }}><b>{label}.</b> {text}</span></div>;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div><button style={btn(true)} onClick={checkManifest} disabled={busy}>{busy ? "Checking…" : "Check this site’s signed manifest"}</button></div>
      {r?.error && <p style={{ ...muted, color: C.flag }}>The manifest could not be loaded. The signing key may not be set up on this server yet.</p>}
      {r?.env && (
        <div style={{ display: "grid", gap: 10 }}>
          {row("Signature", r.sigOk, r.sigOk ? "Valid for the key shown below." : r.sigOk === false ? "Invalid. Do not trust this site." : "This browser cannot verify Ed25519; use the command-line check.")}
          {row("Freshness", r.fresh, `Issued ${r.env.payload.issuedAt.slice(0, 10)}. ${r.fresh ? "Current." : "Expired: this may be an old copy."}`)}
          <div><span style={{ ...muted, color: C.text }}><b>Key fingerprint seen by this page</b></span><span style={mono}>{r.fp}</span></div>
          {expected && <div><span style={{ ...muted, color: C.text }}><b>Fingerprint this server reports</b></span><span style={mono}>{expected}</span></div>}
          <p style={{ ...muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}><b style={{ color: C.text }}>Read this part.</b> A website cannot vouch for itself: a copycat can publish its own key and a perfectly valid signature. The result only means something if the fingerprint above is <b style={{ color: C.text }}>identical</b> to the one published in the independent places listed here.</p>
          <label style={{ ...muted, color: C.text }}><b>Check a file you downloaded:</b> <input type="file" accept=".apk" onChange={checkApk} style={{ marginLeft: 6 }} /></label>
          {apk && !apk.busy && <div><span style={mono}>{apk.sum}</span><p style={{ ...muted, marginTop: 8, color: apk.match ? C.green : C.flag, fontWeight: 700 }}>{apk.match ? `Matches official release ${apk.match}.` : "Does not match any official release in the signed manifest."}</p></div>}
        </div>
      )}
    </div>
  );
}

function Report() {
  const [st, setSt] = useState(null);
  async function send(e) {
    e.preventDefault(); const f = new FormData(e.target); setSt("sending");
    const r = await fetch("/api/distribution/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: f.get("kind"), target: f.get("target"), detail: f.get("detail") }) }).catch(() => null);
    setSt(r?.ok ? "done" : "error"); if (r?.ok) e.target.reset();
  }
  const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "11px 13px", fontSize: 15, width: "100%", boxSizing: "border-box" };
  return (
    <form onSubmit={send} style={{ display: "grid", gap: 10, maxWidth: 560 }}>
      <select name="kind" style={inp} defaultValue="website" aria-label="What are you reporting"><option value="website">A website</option><option value="apk">An APK file or download page</option><option value="app">An app listing</option><option value="other">Something else</option></select>
      <input name="target" placeholder="Link, or where you found it" style={inp} maxLength={250} aria-label="Link or location" />
      <textarea name="detail" placeholder="What made it look wrong? (optional)" style={{ ...inp, minHeight: 84, resize: "vertical" }} maxLength={1500} aria-label="Details" />
      <div><button style={btn(false)} disabled={st === "sending"}>{st === "sending" ? "Sending…" : "Send report"}</button></div>
      {st === "done" && <span style={{ ...muted, color: C.green }}>Thank you. Our security team will look at this.</span>}
      {st === "error" && <span style={{ ...muted, color: C.flag }}>That did not send. Please try again in a moment.</span>}
    </form>
  );
}

const COMPARE_APK = [
  ["Account needed to install", "A store account", "None"],
  ["Who checks the file you get", "The store’s review and scanning", "You, using the published hash, certificate and signed manifest; official builds are also checked when you sign in"],
  ["How updates arrive", "On the store’s schedule", "Signed updates from the app itself, or your choice of channel"],
  ["Where it runs", "Phones that have that store", "Any Android phone, including those without Google Play; iPhone as a web app"],
  ["What links an install to you", "Your store profile and history", "Nothing. Downloads are counted with one-way hashes, not identities"],
];

const COMPARE_WEB = [
  ["Account needed to install", "A store account", "None"],
  ["Who checks what you get", "The store’s review and scanning", "The site is served only from our official address over HTTPS, and you can verify that address against our signed manifest"],
  ["How updates arrive", "On the store’s schedule", "Automatically: the web app is always the current version the next time you open it"],
  ["Where it runs", "Phones that have that store", "Any phone, tablet or computer with a modern browser"],
  ["What links an install to you", "Your store profile and history", "Nothing. Installs are counted per device with a random id and one-way hashes, not identities"],
];

export default function InstallClient({ data, sources, soon, site, kindName }) {
  const [os, setOs] = useState("other"), [prompt, setPrompt] = useState(null), [installed, setInstalled] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent; setOs(/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : /android/i.test(ua) ? "android" : "other");
    const on = (e) => { e.preventDefault(); setPrompt(e); }; window.addEventListener("beforeinstallprompt", on); window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  const { rel, channels, domains } = data;
  const others = channels.filter((c) => c.kind !== "apk");
  const apk = data.apkEnabled !== false;                 // Admin switch: APK downloads on/off. Off = web app only, for every device.
  const COMPARE = apk ? COMPARE_APK : COMPARE_WEB;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 56, padding: "12px 16px 72px" }}>

      {/* ---------------- hero ---------------- */}
      <header style={{ ...card, padding: "40px 28px", display: "grid", gap: 18, background: `linear-gradient(135deg, ${C.surface} 0%, ${C.surface2} 100%)` }}>
        <p style={eyebrow}>Official install guide</p>
        <h1 style={{ ...displayFont, fontSize: 38, lineHeight: 1.12, margin: 0, maxWidth: 720 }}>{apk ? "Install LinkedOut directly from us" : "Install LinkedOut as a web app"}</h1>
        <p style={{ ...muted, fontSize: 17, maxWidth: 700 }}>{apk ? "LinkedOut is distributed from our own website rather than through an app store. That is a deliberate choice, made for stronger privacy, tighter security isolation and authenticity you can verify yourself. This page explains the reasons, walks you through the install, and gives you the tools to check that what you have is genuine." : "LinkedOut installs straight from our own website as a web app, on any phone, tablet or computer, with no app store and no store account. It opens full screen with its own icon and updates itself. This page explains why we chose this, shows you how to install it on your device, and gives you the tools to check that you are on the real LinkedOut."}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
          {!apk && <a href="#android-soon" style={btn(false)}>Android app: coming soon</a>}
          {apk && (rel ? <a href="/dl/apk" style={btn(true)}>Download for Android{rel.name ? ` · v${rel.name}` : ""}</a> : <a href="#android" style={btn(true)}>Android install</a>)}
          {data.pwa && <a href={apk ? "#iphone" : "#webapp"} style={btn(!apk)}>{apk ? "Use on iPhone" : "Install the web app"}</a>}
          <a href="#verify" style={btn(false)}>Verify authenticity</a>
        </div>
        {soon && apk && <p style={{ ...muted, color: C.mustard }}>The Android download is not published yet. You can use LinkedOut in your browser in the meantime.</p>}
        <p style={{ ...muted, fontSize: 13 }}>Official address{domains.length > 1 ? "es" : ""}: {domains.map((d) => <b key={d} style={{ color: C.text, marginRight: 10 }}>{d}</b>)} If you are reading this anywhere else, go to the address above first.</p>
      </header>

      {/* ---------------- Android app: coming soon (APK downloads switched off) ---------------- */}
      {!apk && (
        <section id="android-soon" style={{ ...card, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", borderLeft: `4px solid ${C.mustard}` }}>
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, background: C.surface2, border: `1px solid ${C.line}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: C.mustard }}>A</span>
          <div style={{ flex: "1 1 260px" }}>
            <p style={eyebrow}>Android app</p>
            <h2 style={{ ...displayFont, fontSize: 20, margin: "2px 0 4px" }}>Coming soon</h2>
            <p style={muted}>The LinkedOut Android download isn’t available yet. Until it is, install the web app below: it works on Android and on every other device, with the same account and the same features.</p>
          </div>
        </section>
      )}

      {/* ---------------- why ---------------- */}
      <Section id="why" kicker="Why self-distribution" title={apk ? "What installing directly gives you" : "What installing the web app gives you"} lead="A store listing is one way to receive an app. Installing from us is another, and it comes with protections that a store install does not provide. Here they are, stated concretely so you can judge them.">
        <div style={grid(280)}>
          <Pillar mark="P" title="Higher privacy standard">
            You do not need a Google, Apple or other store account to install LinkedOut, and your install is not attached to a store profile or purchase history. We count downloads by channel and version using one-way hashes, never your name, email or account. The app’s own checks send only the technical details needed to keep accounts safe, never your messages or stories.
          </Pillar>
          <Pillar mark="S" title="Stricter security isolation">
            {!apk ? "The web app runs inside your browser’s security sandbox: it cannot read your other apps or files, and it can use your camera, microphone or notifications only if you allow it. Nothing is installed with system-level permissions, and it is removed cleanly in one tap. Your account protections are exactly the same as on the website." : "Official builds are checked when you sign in, so a copy that is not ours cannot use your account. Each install is kept separate from every other, and a problem with one copy never affects anyone else."}
          </Pillar>
          <Pillar mark="L" title="Legitimacy you can verify">
            Every release is signed. {apk ? "Every release is signed. We publish a signed list of our official addresses, the latest version, its SHA-256 and the certificate it is signed with, and the app only accepts updates signed by us. You never have to take a listing page’s word for it." : "We publish a signed manifest listing our official addresses, so you can check that the site you are on is really ours. The web app can only be installed from, and runs only on, that address, so there is no file to swap or repackage and nothing to sideload."}
          </Pillar>
          <Pillar mark="C" title="Control and continuity">
            {apk ? "Direct distribution works on phones that do not include Google Play, lets us ship security fixes as soon as they are ready, and lets us offer the same signed app through several channels, so no single channel is a single point of failure." : "The web app works on every device with a modern browser, including phones without Google Play, and updates the moment we ship a fix: there is no update to download and no old version left behind."}
          </Pillar>
        </div>

        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620, fontSize: 14.5 }}>
              <thead><tr>{["", "Installing from a store", "Installing from LinkedOut directly"].map((h, i) => <th key={i} style={{ textAlign: "left", padding: "14px 18px", background: C.surface2, borderBottom: `1px solid ${C.line}`, color: i === 2 ? C.mustard : C.text, fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{COMPARE.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: "14px 18px", borderBottom: i === COMPARE.length - 1 ? "none" : `1px solid ${C.line}`, color: j === 0 ? C.text : C.muted, fontWeight: j === 0 ? 600 : 400, lineHeight: 1.55, verticalAlign: "top" }}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>

        <div style={{ ...card, borderLeft: `4px solid ${C.mustard}` }}>
          <h3 style={{ ...displayFont, fontSize: 17, margin: "0 0 6px" }}>The trade-off, stated plainly</h3>
          {!apk ? <p style={muted}>A web app has fewer low-level device features than a native app, and it depends on your browser supporting installation (all current versions of Safari, Chrome, Edge and Samsung Internet do). In exchange you get automatic updates, no store account and no files to trust. You can use the website in a normal browser tab at any time; nothing about your account depends on which route you choose.</p> : <p style={muted}>When you install outside a store, Android asks you to allow installs from your browser, and a store’s review is not part of the process. In its place we publish what you need to check for yourself (a hash for every release, our signing certificate and a signed list of official addresses), and official builds are checked when you sign in. You can use the website instead at any time; nothing about your account depends on which route you choose.</p>}
        </div>
      </Section>

      {/* ---------------- android ---------------- */}
      {apk && <Section id="android" kicker="Android" title="Install on Android" lead={rel ? `Version ${rel.name}${rel.size ? ` · ${rel.size}` : ""}${rel.date ? ` · released ${rel.date}` : ""}.${rel.notes ? " " + rel.notes : ""}` : "The first Android release has not been published yet."}>
        <div style={{ ...card, display: "grid", gap: 20, outline: os === "android" ? `2px solid ${C.mustard}` : "none" }}>
          {rel && <div><a href="/dl/apk" style={btn(true)}>Download the APK</a></div>}
          <Steps items={[
            <>Open the downloaded file. If Android asks, allow your browser or Files app to install apps. You can switch that permission off again afterwards.</>,
            <>Tap <b>Install</b>, then open LinkedOut. The app checks itself with our servers on first launch.</>,
            <>Optional: confirm the file first. Its SHA-256 should be{rel && <span style={mono}>{rel.sha256}</span>}</>,
          ]} />
          {data.certs.length > 0 && <div><p style={{ ...muted, color: C.text, fontWeight: 600 }}>Official signing certificate (SHA-256)</p>{data.certs.map((c) => <span key={c} style={mono}>{c}</span>)}<p style={{ ...muted, fontSize: 13, marginTop: 8 }}>Shown by Android’s app info screen or by <code>apksigner verify --print-certs</code>.</p></div>}
        </div>

        <div id="updates" style={{ display: "grid", gap: 12 }}>
          <h3 style={{ ...displayFont, fontSize: 19, margin: 0 }}>Staying up to date</h3>
          <p style={muted}>Choose whichever suits you. Every option delivers the same signed app.</p>
          <div style={grid(240)}>
            <div style={card}><b>Built-in updater</b><p style={{ ...muted, marginTop: 6 }}>LinkedOut checks for new versions, verifies the download against a signed hash, then asks Android to install it.</p></div>
            {others.map((c) => <a key={c.id} href={`/dl/${c.id}`} style={{ ...card, textDecoration: "none", color: "inherit" }}><b>{kindName[c.kind] || c.label}</b><p style={{ ...muted, marginTop: 6 }}>{c.label}{c.fingerprint ? <> · fingerprint <code>{c.fingerprint}</code></> : null}</p></a>)}
            {site && <a href={`obtainium://add/${site}/dl/apk`} style={{ ...card, textDecoration: "none", color: "inherit" }}><b>Obtainium</b><p style={{ ...muted, marginTop: 6 }}>Add LinkedOut to Obtainium as a direct APK link and be notified of new releases.</p></a>}
          </div>
        </div>
      </Section>}

      {/* ---------------- iphone (APK mode) / web app for every device (APK off) ---------------- */}
      {data.pwa && apk && (
        <Section id="iphone" kicker="iPhone and iPad" title="Use LinkedOut on iPhone" lead="Apple generally allows apps to be installed only through the App Store, so on iPhone LinkedOut installs as a web app. It opens full screen with its own icon, like any other app.">
          <div style={{ ...card, display: "grid", gap: 18, outline: os === "ios" ? `2px solid ${C.mustard}` : "none" }}>
            <Steps items={[
              <>Open <b>{domains[0] || "our website"}</b> in <b>Safari</b>.</>,
              <>Tap the Share button, then <b>Add to Home Screen</b>.</>,
              <>Tap <b>Add</b>, then open LinkedOut from your home screen.</>,
            ]} />
            <p style={{ ...muted, fontSize: 14 }}>The web app is the same site with the same sign-in protections.</p>
            {prompt && !installed && <div><button style={btn(true)} onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>Install the web app on this device</button></div>}
            {installed && <p style={{ ...muted, color: C.green }}>Installed. Open it from your home screen or app list.</p>}
          </div>
        </Section>
      )}

      {data.pwa && !apk && (
        <Section id="webapp" kicker="Web app" title="Install on your device" lead="Pick your device. The steps take about ten seconds and need no download and no account other than your LinkedOut one.">
          <div style={{ display: "grid", gap: 14 }}>
            {[
              ["ios", "iPhone and iPad", [<>Open <b>{domains[0] || "our website"}</b> in <b>Safari</b>.</>, <>Tap the Share button, then <b>Add to Home Screen</b>.</>, <>Tap <b>Add</b>, then open LinkedOut from your home screen.</>]],
              ["android", "Android phones and tablets", [<>Open <b>{domains[0] || "our website"}</b> in <b>Chrome</b> (or Samsung Internet, Edge or Firefox).</>, <>Tap the menu (⋮), then <b>Install app</b> or <b>Add to Home screen</b>.</>, <>Confirm, then open LinkedOut from your home screen or app list.</>]],
              ["other", "Windows, Mac, Linux and Chromebook", [<>Open <b>{domains[0] || "our website"}</b> in <b>Chrome</b> or <b>Edge</b>.</>, <>Click the install icon at the right end of the address bar, or open the browser menu and choose <b>Install LinkedOut</b>.</>, <>LinkedOut opens in its own window and appears in your app list or Start menu.</>]],
            ].map(([k, name, steps]) => (
              <details key={k} open={os === k || (os === "other" && k === "other")} style={{ ...card, outline: os === k ? `2px solid ${C.mustard}` : "none" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 16 }}>{name}{os === k ? " · your device" : ""}</summary>
                <div style={{ marginTop: 14 }}><Steps items={steps} /></div>
              </details>
            ))}
            {prompt && !installed && <div><button style={btn(true)} onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>Install the web app on this device</button></div>}
            {installed && <p style={{ ...muted, color: C.green }}>Installed. Open it from your home screen or app list.</p>}
          </div>
        </Section>
      )}

      {/* ---------------- verify ---------------- */}
      <Section id="verify" kicker="Authenticity" title="Check that it is the real LinkedOut" lead={apk ? "We publish a signed distribution manifest: our official websites, mirrors and stores, the latest version and its SHA-256, and the certificate every genuine build is signed with. It is signed with an Ed25519 key." : "We publish a signed distribution manifest listing our official addresses. It is signed with an Ed25519 key, so you can check that the address you are on is really ours."}>
        <div style={{ ...card, display: "grid", gap: 16 }}>
          <p style={muted}><a href="/.well-known/linkedout-distribution.json" style={{ color: C.mustard, fontWeight: 600 }}>Open the signed manifest</a></p>
          {data.key ? <div><span style={{ ...muted, color: C.text }}><b>Manifest key fingerprint</b></span><span style={mono}>{data.key.fingerprint}</span></div> : <p style={muted}>The signing key has not been set up on this server yet.</p>}
          {sources.length > 0 && <div><p style={{ ...muted, color: C.text }}><b>Compare it with the copies we publish in these independent places. It must match exactly:</b></p><ul style={{ ...muted, paddingLeft: 20, marginTop: 6 }}>{sources.map((s) => <li key={s}>{s}</li>)}</ul></div>}
          <Verifier expected={data.key?.fingerprint} />
          <p style={{ ...muted, fontSize: 14 }}>Prefer your own tools? The manifest is plain JSON signed with Ed25519, and every release hash is SHA-256, so any standard tool can check them.</p>
        </div>
      </Section>

      {/* ---------------- faq ---------------- */}
      <Section id="faq" kicker="Questions" title="Common questions">
        <div style={{ display: "grid", gap: 10 }}>
          {[
            ...(apk ? [["Why does Android show a warning when I install?", "Android shows a general notice for any app that does not come from a store it manages. It is not a finding about LinkedOut. Compare the SHA-256 and signing certificate on this page with your file to confirm what you have."],
            ["Do I have to leave “install unknown apps” switched on?", "No. You only need it for the install itself, and you can turn it off again afterwards in Android’s settings."]] : [["Is the web app really an app?", "It installs with its own icon, opens full screen without browser bars and works like any other app on your device. It is the same LinkedOut, delivered through your browser instead of a file."], ["How do I remove it?", "Press and hold its icon and choose Remove or Uninstall, like any app. Your account and data stay with your LinkedOut account."]]),
            ["Can I just use the website?", "Yes. LinkedOut works in any browser, and your account is the same everywhere."],
            ["I found LinkedOut somewhere else. Is it ours?", "Only the addresses and channels listed in our signed manifest are official. If a site or listing is not on it, do not install from it, and please report it below."],
          ].map(([q, a]) => <details key={q} style={{ ...card, padding: "16px 20px" }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>{q}</summary><p style={{ ...muted, marginTop: 10 }}>{a}</p></details>)}
        </div>
      </Section>

      {/* ---------------- report ---------------- */}
      <Section id="report" kicker="Security" title="Found a fake?" lead="If a site, APK or listing claims to be LinkedOut but is not at one of our official addresses, tell us. We will review it and report it to the host.">
        <div style={card}><Report /></div>
      </Section>
    </div>
  );
}