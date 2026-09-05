import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { seedDatabase } from './db/seed.js';
import { wsServer } from './websocket/websocket.server.js';

import { runMigrations } from './db/migrate.js';

// Auto-migrate & seed demo trader account and initial instruments in non-test environments
if (env.NODE_ENV !== 'test') {
  runMigrations()
    .then(() => seedDatabase())
    .catch((err) => {
      console.error('⚠️ Non-fatal error during auto-migration/seeding:', err);
    });
}

// Start server binding on 0.0.0.0 for container / cloud hosting
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`🚀 Watchlist REST API listening on 0.0.0.0:${env.PORT} [${env.NODE_ENV}]`);
  wsServer.init(server);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  await wsServer.close();
  server.close(async () => {
    try {
      await pool.end();
      console.log('PostgreSQL pool closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error while closing pool:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
