const ADJECTIVES = ["Pixelated", "Feral", "Chronic", "Unhinged", "Undercover", "Nocturnal", "Skeptical", "Overworked", "Caffeinated", "Wandering"];
const NOUNS = ["Intern", "Raccoon", "Otter", "Analyst", "Wolf", "Consultant", "Gremlin", "Pigeon", "Contractor", "Badger"];

export function randomAlias() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${a}${n}#${num}`;
}
