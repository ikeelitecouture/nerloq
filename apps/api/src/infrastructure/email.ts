import { config } from "@nerloq/config";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function sendPasswordResetEmail(email: string, displayName: string, resetUrl: string): Promise<void> {
  const subject = "Reset your NERLOQ password";
  const text = `Hi ${displayName},\n\nUse this one-time link to reset your NERLOQ password. It expires in 30 minutes.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<p>Hi ${escapeHtml(displayName)},</p><p>Use this one-time link to reset your NERLOQ password. It expires in 30 minutes.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`;
  if (config.EMAIL_PROVIDER === "console") {
    if (config.NODE_ENV === "production") throw new Error("Password recovery email delivery is not configured.");
    process.stdout.write(`[NERLOQ password recovery] ${email} ${resetUrl}\n`);
    return;
  }
  if (config.EMAIL_PROVIDER === "smtp") throw new Error("SMTP delivery is not available in this build. Configure Resend or SendGrid.");
  const isResend = config.EMAIL_PROVIDER === "resend";
  const response = await fetch(isResend ? "https://api.resend.com/emails" : "https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.EMAIL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(isResend
      ? { from: config.EMAIL_FROM, to: [email], subject, text, html }
      : { personalizations: [{ to: [{ email }] }], from: { email: config.EMAIL_FROM }, subject, content: [{ type: "text/plain", value: text }, { type: "text/html", value: html }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email provider rejected the recovery message with status ${response.status}.`);
}
