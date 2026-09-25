import nodemailer from "nodemailer";
import type { Env } from "../env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** SMTP mailer from SMTP_URL, or null when email sign-in is off. */
export function createMailer(env: Env): Mailer | null {
  if (!env.SMTP_URL) return null;
  const transport = nodemailer.createTransport(env.SMTP_URL);
  const from = env.MAIL_FROM || `Dualyne <hello@${env.SITE_DOMAIN}>`;
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
  };
}
