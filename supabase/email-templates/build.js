// Builds the Supabase Auth email templates (paste each .html into Supabase → Authentication → Emails → Templates).
// Email-safe: tables, inline styles, no web fonts or SVG, one hosted image. Run: node supabase/email-templates/build.js
const fs = require("fs"), path = require("path");
const SITE = "https://www.swissoutings.com";
const RED = "#D52B1E", INK = "#14181D", MUTED = "#5A646D", BG = "#F3F1EC", CARD = "#FFFFFF", LINE = "#E6E2DA";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function layout({ preheader, hero, title, intro, button, after, footerNote }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="${SITE}/icons/icon-192.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
        <td style="vertical-align:middle;padding-left:10px;font:800 19px/1 ${FONT};color:${INK};letter-spacing:-.2px;">Swiss Outings</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${CARD};border-radius:20px;border:1px solid ${LINE};overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="background:${hero.bg};padding:34px 32px 30px;">
          <div style="font:600 12px/1 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:${hero.kickerColor};">${hero.kicker}</div>
          <div style="font:800 30px/1.15 ${FONT};color:${hero.color};margin-top:10px;letter-spacing:-.4px;">${hero.headline}</div>
          <div style="font:400 16px/1.5 ${FONT};color:${hero.subColor};margin-top:10px;">${hero.sub}</div>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;font:400 16px/1.6 ${FONT};color:${INK};">${intro}</td></tr>
        <tr><td align="left" style="padding:14px 32px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:${RED};border-radius:12px;">
              <a href="${button.href}" style="display:inline-block;padding:15px 30px;font:700 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:12px;">${button.label}</a>
            </td></tr></table>
        </td></tr>
        <tr><td style="padding:14px 32px 0;font:400 13px/1.55 ${FONT};color:${MUTED};">
          Button not working? Copy this link into your browser:<br>
          <a href="${button.href}" style="color:${MUTED};word-break:break-all;">${button.href}</a>
        </td></tr>
        ${after ? `<tr><td style="padding:26px 32px 4px;"><div style="border-top:1px solid ${LINE};"></div></td></tr><tr><td style="padding:12px 32px 30px;">${after}</td></tr>` : `<tr><td style="padding:0 0 26px;"></td></tr>`}
      </table>
    </td></tr>
    <tr><td style="padding:20px 8px 0;font:400 12.5px/1.6 ${FONT};color:${MUTED};text-align:center;">
      ${footerNote}<br>
      <a href="${SITE}" style="color:${MUTED};">swissoutings.com</a> · Concerts, carnivals and village gigs across Switzerland, found every morning.
    </td></tr>
  </table>
</td></tr></table>
</body></html>
`;
}

const perk = (emoji, title, text) => `<tr><td style="width:40px;vertical-align:top;padding:8px 0;font-size:22px;line-height:1;">${emoji}</td>
  <td style="vertical-align:top;padding:8px 0;font:400 14.5px/1.5 ${FONT};color:${MUTED};"><b style="color:${INK};font-weight:700;">${title}</b><br>${text}</td></tr>`;

const templates = {
  "confirm-signup": {
    subject: "Welcome to Swiss Outings! Confirm your email 👋",
    html: layout({
      title: "Confirm your email", preheader: "One tap and you're in: concerts, carnivals and village gigs, found every morning.",
      hero: { bg: "#0B1F33", kicker: "Welcome aboard", kickerColor: "#F5D76E", headline: "You're one tap away 🎉", color: "#FFFFFF", sub: "Confirm your email and your family's outings planner is ready to go.", subColor: "rgba(255,255,255,.82)" },
      intro: "Hi there,<br><br>Thanks for joining Swiss Outings! Please confirm that <b>{{ .Email }}</b> is your email address, so we can keep your account safe and send you the good stuff.",
      button: { href: "{{ .ConfirmationURL }}", label: "Confirm my email" },
      after: `<div style="font:700 15px/1.3 ${FONT};color:${INK};margin-bottom:6px;">What's waiting for you</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${perk("🌙", "Fresh finds every morning", "Every night we read hundreds of event pages across Switzerland, from big concert halls to village councils and nature parks.")}
          ${perk("❤️", "Plan it together", "Tap Keen or Going and your partner and friends see it too. No more lost WhatsApp links.")}
          ${perk("🗺️", "A whole day, planned for you", "Trains, lunch, the weather and fun facts, built around your family in about 15 seconds.")}
        </table>`,
      footerNote: "Didn't sign up for Swiss Outings? You can safely ignore this email. Nothing happens unless you tap the link."
    })
  },
  "reset-password": {
    subject: "Reset your Swiss Outings password",
    html: layout({
      title: "Reset your password", preheader: "Choose a new password and you're back in.",
      hero: { bg: "#F6F1E4", kicker: "Password help", kickerColor: RED, headline: "Forgot your password? It happens. 🔑", color: INK, sub: "Choose a new one and you're straight back to your plans.", subColor: MUTED },
      intro: "Hi there,<br><br>Someone (hopefully you!) asked to reset the password for <b>{{ .Email }}</b>. Tap the button to choose a new one. The link works once and expires soon.",
      button: { href: "{{ .ConfirmationURL }}", label: "Choose a new password" },
      after: null,
      footerNote: "Didn't ask for this? Just ignore this email. Your password stays the same and your account is safe."
    })
  },
  "change-email": {
    subject: "Confirm your new email for Swiss Outings",
    html: layout({
      title: "Confirm your new email", preheader: "One tap to confirm your new email address.",
      hero: { bg: "#F6F1E4", kicker: "Account update", kickerColor: RED, headline: "New email, same outings ✉️", color: INK, sub: "Please confirm your new address.", subColor: MUTED },
      intro: "Hi there,<br><br>You asked to change your Swiss Outings email from <b>{{ .Email }}</b> to <b>{{ .NewEmail }}</b>. Tap the button to confirm.",
      button: { href: "{{ .ConfirmationURL }}", label: "Confirm new email" },
      after: null,
      footerNote: "Didn't ask for this? Ignore this email and nothing changes."
    })
  },
  "magic-link": {
    subject: "Your Swiss Outings sign-in link",
    html: layout({
      title: "Your sign-in link", preheader: "Tap to sign in to Swiss Outings.",
      hero: { bg: "#F6F1E4", kicker: "Sign in", kickerColor: RED, headline: "Here's your link ✨", color: INK, sub: "Tap the button to sign in. No password needed.", subColor: MUTED },
      intro: "Hi there,<br><br>Here's the sign-in link you asked for. It works once and expires soon.",
      button: { href: "{{ .ConfirmationURL }}", label: "Sign me in" },
      after: null,
      footerNote: "Didn't ask for this? Just ignore this email."
    })
  }
};

const dir = __dirname, out = [];
for (const [name, t] of Object.entries(templates)) {
  fs.writeFileSync(path.join(dir, name + ".html"), t.html);
  out.push(`${name}: "${t.subject}"`);
}
fs.writeFileSync(path.join(dir, "SUBJECTS.txt"), out.join("\n") + "\n");
console.log(out.join("\n"));
