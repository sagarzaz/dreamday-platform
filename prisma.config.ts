import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma ORM v7+ moves datasource URLs out of `schema.prisma`.
// This keeps the schema purely structural while connection details remain environment-specific.
export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
    // Optional but recommended for Prisma Migrate in CI/CD:
    // shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});

