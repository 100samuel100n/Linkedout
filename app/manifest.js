// Web app manifest. This is what makes "Add to Home Screen" on iPhone (and "Install" on Android/desktop) open LinkedOut as its own
// full-screen app: no browser bar, its own icon and task-switcher entry.
export default function manifest() {
  return {
    id: "/", name: "LinkedOut", short_name: "LinkedOut", description: "The truth about work.",
    start_url: "/?source=pwa", scope: "/", display: "standalone", display_override: ["standalone", "minimal-ui"], orientation: "any",
    background_color: "#0C1423", theme_color: "#0B0E14", categories: ["social", "business"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [{ name: "Write a story", short_name: "Write", url: "/stories/new?source=pwa" }, { name: "Messages", short_name: "Messages", url: "/messages?source=pwa" }],
  };
}