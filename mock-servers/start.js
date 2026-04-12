/**
 * Simple process launcher for Docker — runs both servers in one container
 */
const { spawn } = require('child_process');

const rpc = spawn('node', ['rpc-server.js'], { stdio: 'inherit', cwd: __dirname });
const ws = spawn('node', ['ws-server.js'], { stdio: 'inherit', cwd: __dirname });

process.on('SIGTERM', () => {
  rpc.kill('SIGTERM');
  ws.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  rpc.kill('SIGINT');
  ws.kill('SIGINT');
  process.exit(0);
});
