// scripts/migrate.js
const pool = require('../config/database');

const migrations = [
  {
    name: 'create_users_table',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `
  },
  {
    name: 'create_files_table',
    sql: `
      CREATE TABLE IF NOT EXISTS files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        mime_type VARCHAR(100),
        minio_key TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(user_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_files_hash ON files(file_hash);
      CREATE INDEX IF NOT EXISTS idx_files_updated ON files(updated_at);
    `
  },
  {
    name: 'create_sync_sessions_table',
    sql: `
      CREATE TABLE IF NOT EXISTS sync_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        last_sync_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sync_sessions_user_device ON sync_sessions(user_id, device_id);
    `
  },
  {
    name: 'create_merkle_trees_table',
    sql: `
      CREATE TABLE IF NOT EXISTS merkle_trees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id VARCHAR(255) NOT NULL,
        root_hash VARCHAR(64),
        tree_data JSONB NOT NULL,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_merkle_trees_user_device ON merkle_trees(user_id, device_id);
      CREATE INDEX IF NOT EXISTS idx_merkle_trees_root_hash ON merkle_trees(root_hash);
      CREATE INDEX IF NOT EXISTS idx_merkle_trees_updated ON merkle_trees(updated_at);
    `
  },
  {
    name: 'update_files_table_for_merkle',
    sql: `
      ALTER TABLE files ADD COLUMN IF NOT EXISTS local_url TEXT;
      ALTER TABLE files ADD COLUMN IF NOT EXISTS upload_status VARCHAR(50) DEFAULT 'pending';
      ALTER TABLE files DROP COLUMN IF EXISTS s3_url;
      
      CREATE INDEX IF NOT EXISTS idx_files_upload_status ON files(upload_status);
      CREATE INDEX IF NOT EXISTS idx_files_minio_key ON files(minio_key);
    `
  },
  {
    name: 'add_minio_key_index',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_files_user_hash ON files(user_id, file_hash);
      CREATE INDEX IF NOT EXISTS idx_files_status_active ON files(status) WHERE status = 'active';
    `
  }
];

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('Running database migrations...');
    
    for (const migration of migrations) {
      console.log(`Running migration: ${migration.name}`);
      await client.query(migration.sql);
      console.log(`✓ ${migration.name} completed`);
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = runMigrations;