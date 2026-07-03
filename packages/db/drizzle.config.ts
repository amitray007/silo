import { defineConfig } from 'drizzle-kit';

// Do not throw when DATABASE_URL is unset: the config must load for offline
// commands like `drizzle-kit generate` (which only diffs the schema) and for
// static analysis (knip). Commands that actually connect — `migrate`, `push`,
// `studio` — fail on their own with an empty URL, which is the right time.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
