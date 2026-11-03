// Hands control back to the native app after browser-based sign-in.
//
// Why not a plain 302 to linkedout://…? Chrome (Android) and some iOS browsers refuse to follow a
// redirect into a custom URL scheme unless the user just tapped something, so the app never
// opened, or opened without ever learning the result. This page tries the redirect automatically
// AND shows a big "Open LinkedOut" button (a real tap always works), with Android's intent:// form
// as a second attempt. Only linkedout:// and Expo dev schemes are ever allowed.
const ALLOWED = /^(linkedout|exp|exps):\/\//;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function appReturnResponse(url, { failed = false } = {}) {
  if (!ALLOWED.test(url)) return new Response("Invalid return URL.", { status: 400 });
  const u = esc(url);
  const js = JSON.stringify(url).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Returning to LinkedOut</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0E14;color:#F4F6FB;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px}
.c{max-width:360px}h1{font-size:22px;margin:0 0 8px}p{color:#AAB3C7;line-height:1.5;margin:0 0 22px}a.b{display:inline-block;background:#E0A526;color:#0B0E14;font-weight:700;text-decoration:none;border-radius:999px;padding:14px 30px;font-size:16px}
.s{width:34px;height:34px;border:3px solid #2a3142;border-top-color:#E0A526;border-radius:50%;margin:0 auto 18px;animation:r 0.9s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body><div class="c">${failed ? "" : '<div class="s"></div>'}<h1>${failed ? "Sign-in didn't finish" : "You're signed in"}</h1>
<p>${failed ? "Open LinkedOut and try again." : "Taking you back to the LinkedOut app. If nothing happens, tap the button."}</p>
<a class="b" id="open" href="${u}">Open LinkedOut</a></div>
<script>(function(){var u=${js};function go(){try{window.location.replace(u)}catch(e){window.location.href=u}}
setTimeout(go,60);
// Android: if the scheme link didn't take, try the explicit intent form once.
if(/android/i.test(navigator.userAgent)){var m=u.match(/^([a-z]+):\\/\\/(.*)$/i);if(m&&m[1]==="linkedout"){setTimeout(function(){window.location.href="intent://"+m[2]+"#Intent;scheme=linkedout;package=com.linkedoutnetwork.linkedout;end"},1400)}}})();</script></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
