// Single source of truth for notification categories. Both lib/email.js
// and app/api/notification-preferences/route.js import from here, so the
// category list, labels, and type→category mapping never drift apart
// between the two.
export const NOTIFICATION_CATEGORIES = {
  engagement: {
    label: "Engagement",
    description: "Reactions, comments, reposts, and poll activity on your posts",
    types: ["reaction", "comment", "repost", "poll_vote", "mention"],
  },
  social: {
    label: "Social",
    description: "New followers and connection activity",
    types: ["follow"],
  },
  messages: {
    label: "Messages",
    description: "New messages and message requests",
    types: ["message", "message_request", "message_accepted"],
  },
  rooms: {
    label: "Vent Rooms",
    description: "Activity in rooms you've joined or created",
    types: ["room_joined", "room_promoted", "room_muted", "room_ended", "room_removed"],
  },
  achievements: {
    label: "Achievements",
    description: "Badges you've earned",
    types: ["badge"],
  },
  company: {
    label: "Company pages",
    description: "Reviews, disputes and status changes on company pages you own",
    types: ["company_update"],
  },
  verification: {
    label: "Verification",
    description: "Updates on your ID, business, or professional verification requests",
    types: ["verification"],
  },
  announcements: {
    label: "Announcements & offers",
    description: "News, product updates and offers from LinkedOut",
    types: ["announcement"],
  },
  account: {
    label: "Account & Security",
    description: "Password changes, new sign-ins, and other account security events",
    types: ["security"],
  },
};

const TYPE_TO_CATEGORY = Object.fromEntries(
  Object.entries(NOTIFICATION_CATEGORIES).flatMap(([cat, def]) => def.types.map((t) => [t, cat]))
);

export function categoryForType(type) {
  return TYPE_TO_CATEGORY[type] || "engagement";
}

export const NOTIFICATION_CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES);
