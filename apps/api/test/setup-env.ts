// Environment for every test file. Uses a separate database (name must end in _test) and Redis db 15.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://dualyne:dualyne@localhost:5432/dualyne_test";
process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? "redis://localhost:6379/15";
