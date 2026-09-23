import { execSync } from "node:child_process";

/**
 * Apply migrations to the test database (non-destructive). Each test file clears the rows it
 * uses in beforeEach, so no database reset is needed.
 */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? "postgresql://dualyne:dualyne@localhost:5432/dualyne_test";
  if (!/_test\b/.test(new URL(url).pathname)) {
    throw new Error(`Refusing to run tests against "${url}": the database name must end in _test.`);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
