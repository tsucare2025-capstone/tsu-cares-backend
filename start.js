// Startup script with better error handling
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting TSU Cares Backend...');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);

// Check if we're in production
if (process.env.NODE_ENV === 'production') {
  console.log('🔧 Running in production mode');
} else {
  console.log('🔧 Running in development mode');
}

// Start the server
const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

server.on('exit', (code, signal) => {
  console.log(`Server exited with code ${code} and signal ${signal}`);
  if (code !== 0) {
    console.error('❌ Server crashed with exit code:', code);
    process.exit(1);
  }
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.kill('SIGINT');
});
