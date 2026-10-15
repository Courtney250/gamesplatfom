import nodemailer from "nodemailer";

export type OutgoingEmail = { to: string; subject: string; text: string; html?: string };
export type EmailSender = (message: OutgoingEmail) => Promise<void>;

export class EmailDeliveryUnavailable extends Error {
  constructor() { super("Email delivery is not configured."); this.name = "EmailDeliveryUnavailable"; }
}

export const sendEmail: EmailSender = async (message) => {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) throw new EmailDeliveryUnavailable();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  try { await transport.sendMail({ from, ...message }); }
  finally { transport.close(); }
};

export function verificationEmail(baseUrl: string, token: string): Omit<OutgoingEmail, "to"> {
  const url = new URL("/verify-email", baseUrl);
  url.searchParams.set("token", token);
  return {
    subject: "Verify your DuelKe email",
    text: `Verify your DuelKe account by opening this one-time link: ${url.toString()}\n\nIf you did not create this account, you can ignore this message.`,
  };
}

export function passwordResetEmail(baseUrl: string, token: string): Omit<OutgoingEmail, "to"> {
  const url = new URL("/reset-password", baseUrl);
  url.searchParams.set("token", token);
  return {
    subject: "Reset your DuelKe password",
    text: `Use this single-use link to reset your DuelKe password: ${url.toString()}\n\nIf you did not request this, ignore this message.`,
  };
}
