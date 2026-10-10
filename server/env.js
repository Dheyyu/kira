// Loads .env before any other module reads process.env. Must be imported first.
try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the real environment
}
