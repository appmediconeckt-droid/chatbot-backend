#!/usr/bin/env node
// Quick Socket.IO connection test
import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:5001';

console.log('🔌 Testing Socket.IO Connection...\n');
console.log(`📡 Server URL: ${SERVER_URL}`);
console.log(`🕐 Time: ${new Date().toISOString()}\n`);

const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

let connected = false;

socket.on('connect', () => {
  connected = true;
  console.log('✅ Socket.IO Connected Successfully!');
  console.log(`   Socket ID: ${socket.id}`);
  console.log(`   Transport: ${socket.io.engine.transport.name}`);
  console.log('\n📊 Connection Details:');
  console.log(`   - Connected: ${socket.connected}`);
  console.log(`   - Disconnected: ${socket.disconnected}`);
  console.log(`   - Auth Status: Pending (waiting for middleware response)`);

  // Test a simple event
  setTimeout(() => {
    socket.emit('test', { message: 'Hello from test client' }, (response) => {
      console.log('\n✅ Test message sent!');
      if (response) console.log('   Server response:', response);
    });
  }, 500);

  // Auto-disconnect after test
  setTimeout(() => {
    console.log('\n🛑 Disconnecting...');
    socket.disconnect();
    process.exit(connected ? 0 : 1);
  }, 2000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection Error:', error.message);
  console.error('   Type:', error.type);
  console.error('   Code:', error.code);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Disconnected:', reason);
});

socket.on('error', (error) => {
  console.error('❌ Socket Error:', error);
});

// Timeout after 10 seconds
setTimeout(() => {
  if (!connected) {
    console.error('\n❌ Connection timeout - server not responding');
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Is backend running? → npm run dev');
    console.log('   2. Check port: netstat -ano | findstr 5001');
    console.log('   3. Check .env file has correct settings');
    socket.disconnect();
    process.exit(1);
  }
}, 10000);
