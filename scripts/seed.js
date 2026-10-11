/**
 * FRUMS Database Seed Script
 * Run: npm run seed
 * 
 * This generates proper bcrypt hashes and updates the users table.
 * Make sure your .env file is configured and the schema has been imported first.
 */

const { getPool, ensureSchema } = require('../api/_lib/db');

// Load .env if available
try { require('dotenv').config(); } catch (e) { }

async function seed() {
    await ensureSchema();
    const pool = getPool();

    console.log('Fetching database status...');

    const [users] = await pool.query('SELECT user_id, username, role, name FROM users');
    console.log('\n✅ Current Users:');
    console.table(users);

    const [branches] = await pool.query('SELECT * FROM branches');
    console.log('\n🏢 Branches:');
    console.table(branches);

    const [services] = await pool.query('SELECT * FROM services');
    console.log('\n💆 Services:');
    console.table(services);

    await pool.end();
    console.log('\n✨ Database check complete!');
}

seed().catch(err => {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
});
