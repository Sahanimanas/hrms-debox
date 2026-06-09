/**
 * seedAdmin.js — Create (or promote) a single ADMIN account.
 *
 * SAFE & NON-DESTRUCTIVE: does NOT clear any collections. It only inserts one
 * admin user/employee, or — if the email already exists — promotes that account
 * to admin and resets its password.
 *
 * Admin accounts can no longer be created via public self-registration, so this
 * script is the supported way to bootstrap an admin from the backend.
 *
 * Usage:
 *   node seedAdmin.js                                  # uses defaults below
 *   node seedAdmin.js <email> <password> "<Full Name>"
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'hrms';

// CLI args (with sensible defaults)
const email = (process.argv[2] || 'aditi.brainwave@gmail.com').toLowerCase().trim();
const password = process.argv[3] || 'Admin@123';
const fullName = process.argv[4] || 'Aditi';

const defaultLeaveBalance = {
  sick_leave: 10.0,
  casual_leave: 15.0,
  paid_leave: 20.0,
  unpaid_leave: 0.0,
};

async function run() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`✅ Connected to database: ${DB_NAME}`);

  const users = db.collection('users');
  const employees = db.collection('employees');

  const hashed = await bcrypt.hash(password, 10);
  const now = new Date();

  const existing = await users.findOne({ email });

  if (existing) {
    // Promote existing account to admin + reset its password.
    await users.updateOne(
      { email },
      { $set: { role: 'admin', hashed_password: hashed, full_name: existing.full_name || fullName } }
    );
    await employees.updateOne(
      { email },
      { $set: { role: 'admin', full_name: existing.full_name || fullName } }
    );
    console.log(`♻️  Existing account found — promoted to ADMIN and password reset.`);
  } else {
    // Create a fresh admin user + matching employee profile.
    const adminId = uuidv4();
    // Unique-ish employee id that won't collide with the EMPxxxx series.
    const employeeId = `ADMIN-${now.getTime().toString().slice(-6)}`;

    await users.insertOne({
      id: adminId,
      employee_id: employeeId,
      email,
      full_name: fullName,
      role: 'admin',
      hashed_password: hashed,
      created_at: now,
    });

    await employees.insertOne({
      id: adminId,
      employee_id: employeeId,
      email,
      full_name: fullName,
      role: 'admin',
      department: 'Administration',
      designation: 'System Administrator',
      phone: null,
      organization_id: null,
      organization_name: null,
      joining_date: now,
      manager_email: null,
      manager_name: null,
      leave_balance: { ...defaultLeaveBalance },
      created_at: now,
    });
    console.log(`🆕 Created new ADMIN account (employee_id: ${employeeId}).`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 ADMIN READY — log in with:');
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}`);
  console.log('='.repeat(60));
  console.log('⚠️  Change this password after your first login.\n');

  await client.close();
}

run().catch((e) => {
  console.error('❌ seedAdmin failed:', e.message);
  process.exit(1);
});
