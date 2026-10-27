// Geography for ad targeting. Countries are ISO 3166-1 alpha-2 codes.
export const COUNTRIES = [
  ["AF", "Afghanistan"],
  ["AL", "Albania"],
  ["DZ", "Algeria"],
  ["AD", "Andorra"],
  ["AO", "Angola"],
  ["AG", "Antigua and Barbuda"],
  ["AR", "Argentina"],
  ["AM", "Armenia"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["AZ", "Azerbaijan"],
  ["BS", "Bahamas"],
  ["BH", "Bahrain"],
  ["BD", "Bangladesh"],
  ["BB", "Barbados"],
  ["BY", "Belarus"],
  ["BE", "Belgium"],
  ["BZ", "Belize"],
  ["BJ", "Benin"],
  ["BT", "Bhutan"],
  ["BO", "Bolivia"],
  ["BA", "Bosnia and Herzegovina"],
  ["BW", "Botswana"],
  ["BR", "Brazil"],
  ["BN", "Brunei"],
  ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"],
  ["BI", "Burundi"],
  ["CV", "Cabo Verde"],
  ["KH", "Cambodia"],
  ["CM", "Cameroon"],
  ["CA", "Canada"],
  ["CF", "Central African Republic"],
  ["TD", "Chad"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["KM", "Comoros"],
  ["CG", "Congo"],
  ["CD", "DR Congo"],
  ["CR", "Costa Rica"],
  ["CI", "Cote d'Ivoire"],
  ["HR", "Croatia"],
  ["CU", "Cuba"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["DJ", "Djibouti"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["EC", "Ecuador"],
  ["EG", "Egypt"],
  ["SV", "El Salvador"],
  ["GQ", "Equatorial Guinea"],
  ["ER", "Eritrea"],
  ["EE", "Estonia"],
  ["SZ", "Eswatini"],
  ["ET", "Ethiopia"],
  ["FJ", "Fiji"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GA", "Gabon"],
  ["GM", "Gambia"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GH", "Ghana"],
  ["GR", "Greece"],
  ["GD", "Grenada"],
  ["GT", "Guatemala"],
  ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"],
  ["GY", "Guyana"],
  ["HT", "Haiti"],
  ["HN", "Honduras"],
  ["HK", "Hong Kong"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["IR", "Iran"],
  ["IQ", "Iraq"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JM", "Jamaica"],
  ["JP", "Japan"],
  ["JO", "Jordan"],
  ["KZ", "Kazakhstan"],
  ["KE", "Kenya"],
  ["KI", "Kiribati"],
  ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"],
  ["LA", "Laos"],
  ["LV", "Latvia"],
  ["LB", "Lebanon"],
  ["LS", "Lesotho"],
  ["LR", "Liberia"],
  ["LY", "Libya"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MO", "Macao"],
  ["MG", "Madagascar"],
  ["MW", "Malawi"],
  ["MY", "Malaysia"],
  ["MV", "Maldives"],
  ["ML", "Mali"],
  ["MT", "Malta"],
  ["MH", "Marshall Islands"],
  ["MR", "Mauritania"],
  ["MU", "Mauritius"],
  ["MX", "Mexico"],
  ["FM", "Micronesia"],
  ["MD", "Moldova"],
  ["MC", "Monaco"],
  ["MN", "Mongolia"],
  ["ME", "Montenegro"],
  ["MA", "Morocco"],
  ["MZ", "Mozambique"],
  ["MM", "Myanmar"],
  ["NA", "Namibia"],
  ["NR", "Nauru"],
  ["NP", "Nepal"],
  ["NL", "Netherlands"],
  ["NZ", "New Zealand"],
  ["NI", "Nicaragua"],
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["KP", "North Korea"],
  ["MK", "North Macedonia"],
  ["NO", "Norway"],
  ["OM", "Oman"],
  ["PK", "Pakistan"],
  ["PW", "Palau"],
  ["PS", "Palestine"],
  ["PA", "Panama"],
  ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["PR", "Puerto Rico"],
  ["QA", "Qatar"],
  ["RO", "Romania"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["KN", "Saint Kitts and Nevis"],
  ["LC", "Saint Lucia"],
  ["VC", "Saint Vincent and the Grenadines"],
  ["WS", "Samoa"],
  ["SM", "San Marino"],
  ["ST", "Sao Tome and Principe"],
  ["SA", "Saudi Arabia"],
  ["SN", "Senegal"],
  ["RS", "Serbia"],
  ["SC", "Seychelles"],
  ["SL", "Sierra Leone"],
  ["SG", "Singapore"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["SB", "Solomon Islands"],
  ["SO", "Somalia"],
  ["ZA", "South Africa"],
  ["KR", "South Korea"],
  ["SS", "South Sudan"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["SD", "Sudan"],
  ["SR", "Suriname"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["SY", "Syria"],
  ["TW", "Taiwan"],
  ["TJ", "Tajikistan"],
  ["TZ", "Tanzania"],
  ["TH", "Thailand"],
  ["TL", "Timor-Leste"],
  ["TG", "Togo"],
  ["TO", "Tonga"],
  ["TT", "Trinidad and Tobago"],
  ["TN", "Tunisia"],
  ["TR", "Turkey"],
  ["TM", "Turkmenistan"],
  ["TV", "Tuvalu"],
  ["UG", "Uganda"],
  ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["UZ", "Uzbekistan"],
  ["VU", "Vanuatu"],
  ["VA", "Vatican City"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["YE", "Yemen"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"]
];
const BY_CODE = new Map(COUNTRIES.map(([c, n]) => [c, n]));
const BY_NAME = new Map(COUNTRIES.map(([c, n]) => [norm(n), c]));
BY_NAME.set("usa", "US"); BY_NAME.set("uk", "GB"); BY_NAME.set("uae", "AE"); BY_NAME.set("america", "US"); BY_NAME.set("united states of america", "US");
export const countryName = (code) => BY_CODE.get(String(code || "").toUpperCase()) || null;

// Lower-case, accent-free, single-spaced: "Nairobi", "nairobi " and "Nairóbi" all compare equal.
function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim(); }
const decode = (s) => { try { return decodeURIComponent(String(s || "")); } catch { return String(s || ""); } };

// Where is this request from? Read from the headers a CDN/host adds: Cloudflare (cf-ipcountry,
// cf-region, cf-ipcity), Vercel (x-vercel-ip-*) and Fastly/CloudFront-style names. Country comes with
// every one of them; city and region need Cloudflare's "Add visitor location headers" (free) or Vercel.
// The app also sends its device region (x-client-country), used only when no network header exists.
export function resolveGeo(headers) {
  const h = (k) => headers.get(k) || "";
  const net = (h("cf-ipcountry") || h("x-vercel-ip-country") || h("cloudfront-viewer-country") || h("x-country-code")).toUpperCase();
  const valid = (c) => /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" && BY_CODE.has(c);
  const device = h("x-client-country").toUpperCase();
  const country = valid(net) ? net : valid(device) ? device : null;
  return {
    country,
    region: decode(h("cf-region") || h("x-vercel-ip-country-region") || h("cloudfront-viewer-country-region-name")) || null,
    city: decode(h("cf-ipcity") || h("x-vercel-ip-city") || h("cloudfront-viewer-city")) || null,
    source: valid(net) ? "network" : valid(device) ? "device" : "unknown",
  };
}

// "KE", "Kenya", "KE/Nairobi", "United States/California" -> { country, place }
export function parseGeoToken(raw) {
  const [a, ...rest] = String(raw || "").split("/");
  const head = a.trim();
  const code = BY_CODE.has(head.toUpperCase()) ? head.toUpperCase() : BY_NAME.get(norm(head));
  if (!code) return null;
  const place = rest.join("/").trim();
  return { country: code, place: place ? norm(place) : "", label: place ? `${code}/${rest.join("/").trim()}` : code };
}

// Admin text box -> clean token list. Accepts commas or new lines. Throws a readable message on typos.
export function parseGeoList(text) {
  const out = [], seen = new Set();
  for (const part of String(text || "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const t = parseGeoToken(part);
    if (!t) throw new Error(`"${part}" isn't a place we recognise. Use a country name or 2-letter code, optionally followed by /Region or /City (for example KE, Kenya, KE/Nairobi, US/California).`);
    if (!seen.has(t.label)) { seen.add(t.label); out.push(t.label); }
  }
  if (out.length > 60) throw new Error("That's a lot of places. Keep it to 60 or fewer.");
  return out;
}

const hits = (tokens, geo) => tokens.some((raw) => {
  const t = parseGeoToken(raw); if (!t || t.country !== geo.country) return false;
  if (!t.place) return true;                       // whole country
  return t.place === norm(geo.city) || t.place === norm(geo.region);
});

// Does an ad's audience include this viewer? No targeting = everyone. A targeted ad is never shown
// to someone whose location we can't tell (better to under-serve than to break a campaign's promise).
export function adMatchesGeo(spec, geo) {
  const include = spec?.include || [], exclude = spec?.exclude || [];
  if (!include.length && !exclude.length) return true;
  if (!geo?.country) return include.length === 0;
  if (exclude.length && hits(exclude, geo)) return false;
  return include.length === 0 || hits(include, geo);
}
export const describeGeo = (spec) => {
  const i = spec?.include || [], x = spec?.exclude || [];
  if (!i.length && !x.length) return "Worldwide";
  return [i.length ? i.join(", ") : "Worldwide", x.length ? `not ${x.join(", ")}` : ""].filter(Boolean).join("; ");
};
