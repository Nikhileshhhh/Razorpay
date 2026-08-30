import 'dotenv/config';

// Integration tests need the local disposable PostgreSQL base URL. dotenv is
// silent by default, and no test or failure formatter emits configuration
// values. CI can provide DATABASE_URL directly and it takes precedence.
