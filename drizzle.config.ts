import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.LIBRARY_ROOT ? `${process.env.LIBRARY_ROOT}/library.db` : './library/library.db' },
});
