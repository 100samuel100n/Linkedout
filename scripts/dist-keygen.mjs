// Generates the Ed25519 key that signs the distribution manifest and update answers.
//   node scripts/dist-keygen.mjs
// Put the PRIVATE value in DIST_SIGNING_KEY on the server (Fly: `fly secrets set DIST_SIGNING_KEY="$(cat key.pem)"`), keep an offline backup,
// put the PUBLIC value in the app build (EXPO_PUBLIC_DIST_PUBLIC_KEY), and publish the FINGERPRINT in several independent places.
import crypto from "node:crypto";
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const fp = crypto.createHash("sha256").update(raw).digest("hex").toUpperCase().match(/.{1,4}/g).join(" ");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
console.log("# PRIVATE (server secret, never commit):\nDIST_SIGNING_KEY=\"" + pem.trim().replace(/\n/g, "\\n") + "\"\n");
console.log("# PUBLIC (goes into the app build):\nEXPO_PUBLIC_DIST_PUBLIC_KEY=" + raw.toString("base64url") + "\n");
console.log("# FINGERPRINT (publish in several independent places):\n" + fp);
