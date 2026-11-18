import { isGoogleOAuthConfigured, validateEnv } from './env.validation';

const validBaseEnv: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://ecommerce_admin:secret@localhost:5433/ecommerce_saas?schema=public',
  JWT_ACCESS_SECRET: 'super_secret_access_key_minimum_16_chars',
  JWT_REFRESH_SECRET: 'super_secret_refresh_key_minimum_16_chars',
  OAUTH_STATE_SECRET: 'super_secret_oauth_state_minimum_16_chars',
};

describe('env.validation', () => {
  describe('validateEnv', () => {
    it('applies defaults and coerces PORT and SMTP_SECURE', () => {
      const parsed = validateEnv({
        ...validBaseEnv,
        PORT: '4100',
        SMTP_SECURE: 'true',
      });

      expect(parsed.NODE_ENV).toBe('development');
      expect(parsed.PORT).toBe(4100);
      expect(parsed.SMTP_SECURE).toBe(true);
      expect(parsed.MAIL_FROM_NAME).toBe('Vendexa E-Commerce');
      expect(parsed.MAIL_FROM_ADDRESS).toBe('no-reply@vendexa.local');
    });

    it('defaults SMTP_SECURE to false when omitted or "false"', () => {
      expect(validateEnv(validBaseEnv).SMTP_SECURE).toBe(false);
      expect(validateEnv({ ...validBaseEnv, SMTP_SECURE: 'false' }).SMTP_SECURE).toBe(false);
    });

    it('throws when DATABASE_URL is missing or empty', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(() =>
        validateEnv({
          ...validBaseEnv,
          DATABASE_URL: '',
        }),
      ).toThrow('Fallo en validación de variables de entorno.');
      consoleSpy.mockRestore();
    });

    it('throws when JWT secrets are shorter than 16 characters', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(() =>
        validateEnv({
          ...validBaseEnv,
          JWT_ACCESS_SECRET: 'too-short',
        }),
      ).toThrow('Fallo en validación de variables de entorno.');
      consoleSpy.mockRestore();
    });
  });

  describe('isGoogleOAuthConfigured', () => {
    it('returns false when credentials are empty or whitespace', () => {
      expect(isGoogleOAuthConfigured({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' })).toBe(
        false,
      );
      expect(
        isGoogleOAuthConfigured({
          GOOGLE_CLIENT_ID: '   ',
          GOOGLE_CLIENT_SECRET: 'real-secret',
        }),
      ).toBe(false);
    });

    it('returns false for default .env placeholder values', () => {
      expect(
        isGoogleOAuthConfigured({
          GOOGLE_CLIENT_ID: 'your-google-client-id.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'your-google-client-secret',
        }),
      ).toBe(false);
      expect(
        isGoogleOAuthConfigured({
          GOOGLE_CLIENT_ID: 'changeme',
          GOOGLE_CLIENT_SECRET: 'placeholder',
        }),
      ).toBe(false);
      expect(
        isGoogleOAuthConfigured({
          GOOGLE_CLIENT_ID: 'example-client-id',
          GOOGLE_CLIENT_SECRET: 'real-secret-value',
        }),
      ).toBe(false);
    });

    it('returns true when real non-placeholder credentials are provided', () => {
      expect(
        isGoogleOAuthConfigured({
          GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'GOCSPX-realSecretValue123',
        }),
      ).toBe(true);
    });
  });
});
