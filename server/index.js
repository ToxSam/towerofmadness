/**
 * Tower of Madness - Authoritative Server
 * 
 * This is the server entry point for Railway/hosted deployment.
 * It starts the Decentraland hammurabi authoritative server.
 * 
 * Deploy to Railway:
 * 1. Set Root Directory to / (project root, NOT /server)
 * 2. Start Command: node server/index.js
 * 3. Get your URL and update scene.json with serverUrl
 * 
 * The Hammurabi server needs access to bin/index.js (compiled scene)
 * which is in the project root.
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('═══════════════════════════════════════════════════════');
console.log('🎮 TOWER OF MADNESS - Authoritative Server');
console.log('═══════════════════════════════════════════════════════');
console.log('Starting Decentraland Hammurabi Server...');
console.log('');

// Get port from environment (Railway sets this) or use default
const PORT = process.env.PORT || 8000;
console.log(`📡 Server will listen on port: ${PORT}`);

// Get the project root directory (parent of server/)
const projectRoot = path.resolve(__dirname, '..');
console.log(`📁 Project root: ${projectRoot}`);
console.log(`📁 Scene code: ${path.join(projectRoot, 'bin', 'index.js')}`);
console.log('');

// Start the hammurabi server from the project root
const server = spawn('npx', ['@dcl/hammurabi-server@next'], {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot,  // Run from project root so it can find bin/index.js
  env: {
    ...process.env,
    PORT: PORT.toString()
  }
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});

server.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
  process.exit(code || 0);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('');
  console.log('📴 Received SIGTERM, shutting down gracefully...');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('');
  console.log('📴 Received SIGINT, shutting down gracefully...');
  server.kill('SIGINT');
});

// Keep alive heartbeat
setInterval(() => {
  // Heartbeat to keep Railway from killing the process
}, 30000);

console.log('✅ Server process started');
console.log('═══════════════════════════════════════════════════════');
