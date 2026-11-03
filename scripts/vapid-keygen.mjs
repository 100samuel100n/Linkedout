// Generates the VAPID key pair used to send Web Push notifications to the installed web app.
//   node scripts/vapid-keygen.mjs
// Put the three values in the server environment (Fly: `fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@domain`).
// Keep the private key secret and never change it later: changing it silently drops every existing web subscription.
import crypto from "node:crypto";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" }), prv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
console.log("VAPID_PUBLIC_KEY=" + raw.toString("base64url")); console.log("VAPID_PRIVATE_KEY=" + prv.d); console.log("VAPID_SUBJECT=mailto:net.linkedout@gmail.com");
