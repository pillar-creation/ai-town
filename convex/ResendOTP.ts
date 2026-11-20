import { Email } from '@convex-dev/auth/providers/Email';
import { RandomReader, generateRandomString } from '@oslojs/crypto/random';
import { Resend as ResendAPI } from 'resend';

const FROM = process.env.AUTH_EMAIL ?? '伊甸园 <onboarding@resend.dev>';

export const ResendOTP = Email({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 15,
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    };
    return generateRandomString(random, '0123456789', 8);
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new ResendAPI(provider.apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: [email],
      subject: '伊甸园登录验证码',
      text: `你的验证码是 ${token}，15 分钟内有效。\n\n若非本人操作，请忽略此邮件。`,
      html: `
        <div style="font-family:sans-serif;line-height:1.6">
          <p>你的验证码是：</p>
          <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${token}</p>
          <p>15 分钟内有效。若非本人操作，请忽略此邮件。</p>
        </div>
      `,
    });
    if (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
