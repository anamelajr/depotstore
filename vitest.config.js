import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/__tests__/**/*.test.{js,mjs}"],
    globals: false,
  },
});
