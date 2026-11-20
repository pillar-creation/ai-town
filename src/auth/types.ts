export type AuthStep = 'email' | 'otp';

export type AuthSessionView = {
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  role: 'visitor';
};
