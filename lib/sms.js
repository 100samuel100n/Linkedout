// SMS delivery through Telnyx's Messages API. Only used for the one-time
// verification codes generated and checked by lib/identity/phone-otp.js —
// the code logic lives in our own database, Telnyx just carries the text.
//
// Env:
//   TELNYX_API_KEY               required — v2 API key (KEY...)
//   TELNYX_FROM_NUMBER           the long code / toll-free number, E.164
//   TELNYX_MESSAGING_PROFILE_ID  optional — used when sending from a
//                                messaging profile or alphanumeric sender id
const TELNYX_URL = "https://api.telnyx.com/v2/messages";

export function isSmsConfigured() {
  return Boolean(process.env.TELNYX_API_KEY && (process.env.TELNYX_FROM_NUMBER || process.env.TELNYX_MESSAGING_PROFILE_ID));
}

export async function sendVerificationSms(toPhone, code) {
  if (!isSmsConfigured()) return { sent: false, reason: "SMS_NOT_CONFIGURED" };

  const body = {
    to: toPhone,
    text: `Your LinkedOut code is ${code}`,
    type: "SMS",
  };
  if (process.env.TELNYX_FROM_NUMBER) body.from = process.env.TELNYX_FROM_NUMBER;
  if (process.env.TELNYX_MESSAGING_PROFILE_ID) body.messaging_profile_id = process.env.TELNYX_MESSAGING_PROFILE_ID;

  try {
    const res = await fetch(TELNYX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The code itself is never logged.
      console.error(`[sms] Telnyx rejected message (HTTP ${res.status}): ${detail.slice(0, 300)}`);
      return { sent: false, reason: `TELNYX_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("[sms] Telnyx request failed:", e.message);
    return { sent: false, reason: "NETWORK" };
  }
}
