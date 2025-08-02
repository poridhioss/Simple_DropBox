// client/client.js - Main entry point
const api = require('./lib/api');
const fileWatcher = require('./lib/file-watcher');
const sync = require('./lib/sync');
const config = require('./config');

async function main() {
  console.log('🚀 Starting File Sync Client...');
  console.log(`📱 Device ID: ${config.DEVICE_ID}`);
  console.log(`📂 Watch Directory: ${config.WATCH_DIRECTORY}`);
  console.log(`🌐 Server: ${config.API_BASE_URL}`);
  
  try {
    // Authenticate
    await api.authenticate();
    
    // Start file watcher
    await fileWatcher.startWatcher();
    
    // Start periodic sync
    sync.startPeriodicSync();
    
    console.log('✅ Client started successfully!');
    console.log('💡 Add files to the sync folder to see them upload automatically');
    console.log('🛑 Press Ctrl+C to stop');
    
  } catch (error) {
    console.error('❌ Failed to start client:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  try {
    await fileWatcher.stopWatcher();
    console.log('👋 Goodbye!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the client
main();