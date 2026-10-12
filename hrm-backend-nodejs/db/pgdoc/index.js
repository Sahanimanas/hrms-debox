/**
 * pgdoc — a PostgreSQL-backed document store exposing the MongoDB Node
 * driver API subset this application uses (collections, cursors, query and
 * update operators, aggregation, unique/TTL indexes).
 *
 *   const { PgDocClient } = require('./db/pgdoc');
 *   const client = await new PgDocClient(process.env.DATABASE_URL).connect();
 *   const db = client.db('hrms');            // a PostgreSQL schema
 *   await db.collection('users').findOne({ email });
 */

const { PgDocClient, Db } = require('./client');
const { Collection } = require('./collection');
const { ObjectId } = require('./bson');

module.exports = { PgDocClient, Db, Collection, ObjectId };
