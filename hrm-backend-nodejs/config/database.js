/**
 * Database connection (PostgreSQL).
 *
 * Data lives in PostgreSQL through the pgdoc document store (db/pgdoc):
 * DATABASE_URL picks the server/database and DB_NAME the schema, with one
 * table per collection. getDB() returns an object with the familiar
 * collection API (find, updateOne, aggregate, ...), so route code is
 * unchanged.
 */

const { PgDocClient } = require('../db/pgdoc');

let client = null;
let db = null;

const connectDB = async (databaseUrl, dbName) => {
  try {
    databaseUrl = databaseUrl || process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/hrms';
    dbName = dbName || process.env.DB_NAME || 'hrms_production';

    if (client) await client.close().catch(() => {});
    client = new PgDocClient(databaseUrl);
    await client.connect();

    db = client.db(dbName);

    // Test connection and make sure the schema exists
    await db.command({ ping: 1 });
    await db._ensureSchema();
    console.log('✅ PostgreSQL connected successfully');

    return db;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    throw error;
  }
};

const getDB = () => {
  return db;
};

const getClient = () => client;

const closeDB = async () => {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('PostgreSQL connection closed');
  }
};

module.exports = {
  connectDB,
  getDB,
  getClient,
  closeDB
};
