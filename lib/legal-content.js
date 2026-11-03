// Single source of truth for the Terms of Use and Privacy Policy. The native app
// carries an identical copy (native lib/legal-content.js) so both surfaces always
// say the same thing — when you edit one, edit the other.
export const LEGAL_UPDATED = "7 October 2026";

export const INDEPENDENCE_NOTICE =
  "LinkedOut is an independent platform. It is not affiliated with, endorsed by, sponsored by, or connected to any other company, service, brand or organization. Any other names mentioned belong to their respective owners.";

export const TERMS = {
  title: "Terms of Use",
  intro:
    "These terms explain how LinkedOut works and what we ask of each other. We've written them in plain language and kept them as light as we can. By creating an account or using LinkedOut, you agree to them.",
  sections: [
    {
      h: "1. Who we are",
      p: [
        "LinkedOut is a space for honest conversation about work and careers. You can share, react, message, join Vent Rooms and follow companies, under a pseudonym if you like.",
        INDEPENDENCE_NOTICE,
      ],
    },
    {
      h: "2. Using LinkedOut",
      p: [
        "You must be old enough to use online services where you live, and at least 16 years old. Please give accurate sign-up details, keep your login safe, and let us know if you think someone else has accessed your account.",
        "You're responsible for what you post. Be honest, be kind to people even when you're critical of institutions, and keep within the law.",
      ],
    },
    {
      h: "3. What we ask you not to do",
      p: ["To keep the community safe and useful, please don't:"],
      list: [
        "harass, threaten or target people, or share hate content",
        "post someone's private information, or identify people who haven't chosen to be identified",
        "share content that is illegal, sexually explicit involving minors, or that promotes self-harm or violence",
        "impersonate people or organizations, or mislead others about who you are",
        "spam, scrape, or attempt to disrupt or break into the service",
        "post claims about a named company or person that you know to be false",
      ],
    },
    {
      h: "4. Your content",
      p: [
        "You keep ownership of what you post. To run LinkedOut, you give us a non-exclusive licence to host, display, distribute and back up your content within the service. That licence ends when you delete the content or your account, apart from copies we reasonably need for backups, safety or legal reasons for a short period.",
        "Please only post content you have the right to share. If you believe something infringes your rights, use the copyright notice form and we'll look into it.",
      ],
    },
    {
      h: "5. Pseudonyms and privacy between members",
      p: [
        "LinkedOut is designed so you can take part without exposing your real identity to other members. Please respect that for others too. Attempting to unmask or expose another member is a breach of these terms.",
      ],
    },
    {
      h: "6. Moderation",
      p: [
        "We review reports and may remove content, limit features or suspend accounts that break these terms or put people at risk. Where we can, we'll tell you what happened and give you a chance to appeal from within the app.",
      ],
    },
    {
      h: "7. Plans and payments",
      p: [
        "OUT is free. OUT+ and OUT PRO are paid plans billed through our payment provider. You can change or cancel a paid plan at any time and it stays active until the end of the period you've paid for. Prices and features are shown before you subscribe. Where the law gives you refund or cooling-off rights, those apply.",
      ],
    },
    {
      h: "8. Security",
      p: [
        "We take the security of your data seriously and use industry-standard safeguards to protect it, described in our Privacy Policy. You can add two-factor authentication to your account in Settings and we recommend you do.",
      ],
    },
    {
      h: "9. Ending your account",
      p: [
        "You can deactivate (temporary) or delete (permanent) your account at any time from Settings. We may suspend or close accounts that seriously or repeatedly break these terms.",
      ],
    },
    {
      h: "10. Humour and opinion",
      p: [
        "Much of LinkedOut is satire, venting and personal opinion. Posts reflect their authors' views, not ours, and are not professional, legal, financial or career advice.",
      ],
    },
    {
      h: "11. Third-party services",
      p: [
        "LinkedOut may link to or work alongside services provided by others (for example sign-in, payments, hosting and AI features). Those services are run by their own providers under their own terms, and our use of them does not imply any partnership or affiliation.",
      ],
    },
    {
      h: "12. Service changes and availability",
      p: [
        "We work hard to keep LinkedOut running well, but we can't promise it will always be uninterrupted or error-free. We may improve, change or retire features over time and will give notice of significant changes where we reasonably can.",
      ],
    },
    {
      h: "13. Liability",
      p: [
        "LinkedOut is provided as is. To the extent the law allows, we aren't liable for indirect or consequential losses, or for content posted by members. Nothing in these terms limits any rights or liability that cannot be limited by law.",
      ],
    },
    {
      h: "14. Stories, evidence and right of reply",
      p: [
        "Stories are first-hand accounts of what someone experienced. LinkedOut preserves them and is precise about what it knows: labels such as \"Evidence attached\" or \"Multiple independent reports\" describe what has been provided, never that a story is true. We do not verify stories.",
        "Write about what you experienced and saw, not about what you believe others intended. Do not post private information about other people (home addresses, phone numbers, ID or account numbers, private medical details); we remove emails, phone numbers, ID numbers and account numbers automatically. Do not accuse named private individuals of crimes. Content that does so can be removed.",
        "Anyone mentioned in a story, and any company, can ask for a story to be reviewed from the story page. Verified company representatives can publish a response next to a story and a statement on their company timeline. Companies cannot remove, hide or edit stories, and cannot see who wrote them. We review reports using the evidence available and may remove content that breaks these terms. We do not reveal who wrote a story except where the law requires it.",
        "Evidence you attach is stored privately and is not shown to other users. Summaries, patterns and the Workplace Reality Index are built from the stories people choose to share; they describe those reports and are not findings about any company.",
      ],
    },
    {
      h: "15. Changes to these terms",
      p: [
        "We may update these terms as LinkedOut evolves. When changes are important, we'll let you know in the app or by email before they take effect. Continuing to use LinkedOut after that means you accept the updated terms.",
      ],
    },
    {
      h: "16. Contact",
      p: ["Questions about these terms? Reach us any time through Help & Support in the app."],
    },
  ],
};

export const PRIVACY = {
  title: "Privacy Policy",
  intro:
    "Your privacy is central to what LinkedOut is. This policy explains what we collect, why, how we keep it secure, and the choices you have.",
  sections: [
    {
      h: "1. Independence",
      p: [INDEPENDENCE_NOTICE, "We don't receive data from, or share your data with, any other platform for their own purposes."],
    },
    {
      h: "2. What we collect",
      list: [
        "Account details: email, name, the pseudonym you choose, optional bio, country and interests",
        "Content you create: posts, comments, reactions, messages, Vent Room participation and uploads",
        "Verification material you choose to submit (for example, a document for identity or business verification)",
        "Technical information: device and browser type, approximate region, and security logs used to protect accounts",
        "Payment status from our payment provider (we don't store full card numbers)",
      ],
    },
    {
      h: "3. How we use it",
      list: [
        "to run LinkedOut and keep your account working",
        "to show your content to the audience you choose, under your pseudonym",
        "to keep the community safe: preventing abuse, fraud and security incidents",
        "to send notifications and emails you've asked for, and service messages",
        "to improve the product, using aggregated and de-identified information where possible",
        "to meet legal obligations",
      ],
    },
    {
      h: "4. How we keep your data secure",
      p: [
        "Protecting your data is a core responsibility. We use safeguards such as encryption of data in transit, encryption of private messages at rest, salted hashing of passwords, restricted staff access with logging and two-factor authentication, secure storage with private buckets for verification documents, and rate limiting against abuse.",
        "You can strengthen your own account with two-factor authentication and by using a unique password. No online service can promise perfect security, but we work continuously to protect your information and will notify you promptly if a breach affecting you occurs.",
      ],
    },
    {
      h: "5. Your pseudonym and your identity",
      p: [
        "Other members see your pseudonym and what you choose to share. We don't reveal the link between your pseudonym and your real details to other members, and we don't sell it.",
      ],
    },
    {
      h: "6. Sharing",
      p: [
        "We don't sell your personal data. We share it only with service providers who help us run LinkedOut (hosting, storage, email and SMS delivery, payments, push notifications, AI features, analytics and advertising where enabled) under agreements that limit how they can use it, or where the law requires it. We review legal requests carefully and don't comply automatically.",
      ],
    },
    {
      h: "7. AI features",
      p: [
        "Some optional features (such as the Title Translator, Roast My Resume and AI-assisted outreach) send the text you provide to an AI provider to generate a response. Use them only with content you're comfortable sharing. We don't use your private messages to power them.",
      ],
    },
    {
      h: "8. Your choices and rights",
      list: [
        "view and edit your profile and preferences in Settings",
        "control who can message you and what notifications you receive",
        "deactivate your account temporarily, or delete it permanently",
        "ask us about the data we hold about you through Help & Support",
        "where your local law gives you more rights (for example access, correction, portability or objection), we'll honour them",
      ],
    },
    {
      h: "9. Retention",
      p: [
        "We keep data for as long as your account is active. When you delete your account we remove your profile and personal information, and delete or de-identify the rest within a reasonable period, except where we must retain something for security or legal reasons.",
      ],
    },
    {
      h: "10. Cookies and similar technology",
      p: [
        "We use essential cookies and local storage for sign-in, security and your preferences (such as theme). Where advertising is enabled, our ad partners may use their own technology, subject to your device and regional settings.",
      ],
    },
    {
      h: "11. Children",
      p: ["LinkedOut isn't intended for people under 16. If we learn that a child has created an account, we'll remove it."],
    },
    {
      h: "12. International use",
      p: ["Your data may be processed in countries other than your own. We apply the same protections wherever it's handled."],
    },
    {
      h: "13. Changes and contact",
      p: [
        "If we make important changes to this policy we'll tell you in the app or by email. For privacy questions or requests, contact us through Help & Support.",
      ],
    },
  ],
};
