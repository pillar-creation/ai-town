import Resend from '@auth/core/providers/resend';
import { convexAuth } from '@convex-dev/auth/server';
import { ResendOTP } from './ResendOTP';

const FROM = process.env.AUTH_EMAIL ?? '伊甸园 <onboarding@resend.dev>';

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Resend({
      from: FROM,
      // Magic-link emails via Auth.js Resend provider.
    }),
    ResendOTP,
  ],
});
