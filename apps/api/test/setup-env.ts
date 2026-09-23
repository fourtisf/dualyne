// Environment for every test file. Uses a separate database (name must end in _test) and Redis db 15.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://refract:refract@localhost:5432/refract_test";
process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? "redis://localhost:6379/15";
