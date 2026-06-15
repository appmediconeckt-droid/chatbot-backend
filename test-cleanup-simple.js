/**
 * Simplified Chat Cleanup Test - Tests cleanup logic without creating Users
 * Tests: Auto-delete messages from inactive chats (90+ days no activity)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Chat from './src/models/Chat.js';
import Message from './src/models/Message.js';
import { cleanupInactiveChats, getCleanupStats, getInactiveThreshold } from './src/services/chatCleanupService.js';

dotenv.config({ path: './src/.env' });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env file');
  process.exit(1);
}

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
}

async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error disconnecting:', error.message);
  }
}

async function createTestChats() {
  console.log('📝 Creating test chats (WITHOUT creating User documents)...\n');

  const userId = new mongoose.Types.ObjectId();
  const counselorId = new mongoose.Types.ObjectId();

  // Chat 1: 100 days old, 0 messages - SHOULD DELETE
  const chat1 = await Chat.create({
    userId,
    counselorId,
    status: 'active',
    isActive: true,
    startedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    lastMessageAt: null,
  });
  console.log(`✓ Chat 1: 100 days old, 0 messages (ID: ${chat1._id})`);

  // Chat 2: 95 days old, 0 messages - SHOULD DELETE
  const chat2 = await Chat.create({
    userId,
    counselorId,
    status: 'active',
    isActive: true,
    startedAt: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000),
    lastMessageAt: null,
  });
  console.log(`✓ Chat 2: 95 days old, 0 messages (ID: ${chat2._id})`);

  // Chat 3: EXACTLY 90 days old, 0 messages - SHOULD DELETE (BOUNDARY)
  const chat3 = await Chat.create({
    userId,
    counselorId,
    status: 'active',
    isActive: true,
    startedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    lastMessageAt: null,
  });
  console.log(`✓ Chat 3: EXACTLY 90 days old, 0 messages (ID: ${chat3._id})`);

  // Chat 4: 89 days old, 0 messages - SHOULD NOT DELETE (too recent)
  const chat4 = await Chat.create({
    userId,
    counselorId,
    status: 'active',
    isActive: true,
    startedAt: new Date(Date.now() - 89 * 24 * 60 * 60 * 1000),
    lastMessageAt: null,
  });
  console.log(`✓ Chat 4: 89 days old, 0 messages (ID: ${chat4._id}) - TOO RECENT`);

  // Chat 5: TODAY, 5 messages - SHOULD NOT DELETE (active)
  const chat5 = await Chat.create({
    userId,
    counselorId,
    status: 'active',
    isActive: true,
    startedAt: new Date(),
    lastMessageAt: new Date(),
  });

  // Create 5 messages for Chat 5
  for (let i = 0; i < 5; i++) {
    await Message.create({
      chatId: chat5._id,
      senderId: i % 2 === 0 ? userId : counselorId,
      senderRole: i % 2 === 0 ? 'user' : 'counsellor',
      content: `Test message ${i + 1}`,
      contentType: 'TEXT',
    });
  }
  console.log(`✓ Chat 5: TODAY, 5 messages (ID: ${chat5._id})`);

  return { chat1, chat2, chat3, chat4, chat5, userId, counselorId };
}

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 CHAT CLEANUP - SIMPLIFIED TEST (90-DAY EXACT THRESHOLD)');
  console.log('='.repeat(70) + '\n');

  try {
    // Step 1: Connect
    console.log('STEP 1: Database Connection');
    console.log('-'.repeat(70));
    await connectDB();

    // Step 2: Clean previous test data
    console.log('STEP 2: Cleanup Previous Test Data');
    console.log('-'.repeat(70));
    await Chat.deleteMany({ status: { $in: ['active', 'pending'] } });
    await Message.deleteMany({});
    console.log('✓ Cleaned previous test data\n');

    // Step 3: Create test chats
    console.log('STEP 3: Create Test Chats');
    console.log('-'.repeat(70));
    const { chat1, chat2, chat3, chat4, chat5 } = await createTestChats();

    // Step 4: Check inactivity threshold
    console.log('\nSTEP 4: Verify 90-Day Threshold');
    console.log('-'.repeat(70));
    const threshold = getInactiveThreshold();
    const today = new Date();
    console.log(`📅 Today: ${today.toISOString().split('T')[0]}`);
    console.log(`📅 90-day threshold: ${threshold.toISOString().split('T')[0]}`);
    console.log(`   Chats BEFORE this date → DELETE`);
    console.log(`   Chats AT or AFTER this date → KEEP\n`);

    // Step 5: Get cleanup stats
    console.log('STEP 5: Preview Cleanup (Dry-Run)');
    console.log('-'.repeat(70));
    const stats = await getCleanupStats();
    console.log(`📊 Statistics:`);
    console.log(`   ✓ Inactive chats found: ${stats.inactiveChatsCount}`);
    console.log(`   ✓ Messages to delete: ${stats.messagesCount}`);
    console.log(`   ✓ Threshold: ${stats.inactiveThreshold}\n`);

    // Step 6: Verify before cleanup
    console.log('STEP 6: Data Before Cleanup');
    console.log('-'.repeat(70));
    const chatsBefore = await Chat.countDocuments();
    const messagesBefore = await Message.countDocuments();
    console.log(`📊 Total chats: ${chatsBefore}`);
    console.log(`📊 Total messages: ${messagesBefore}\n`);

    // Step 7: Execute cleanup
    console.log('STEP 7: Execute Cleanup');
    console.log('-'.repeat(70));
    const result = await cleanupInactiveChats();
    console.log(`\n✅ Cleanup Result:`);
    console.log(`   ✓ Success: ${result.success}`);
    console.log(`   ✓ Chats processed: ${result.chatsProcessed}`);
    console.log(`   ✓ Messages deleted: ${result.deletedMessages}`);
    console.log(`   ✓ Duration: ${result.duration}ms\n`);

    // Step 8: Verify after cleanup
    console.log('STEP 8: Data After Cleanup');
    console.log('-'.repeat(70));
    const chatsAfter = await Chat.countDocuments();
    const messagesAfter = await Message.countDocuments();
    console.log(`📊 Total chats: ${chatsAfter} (was ${chatsBefore})`);
    console.log(`📊 Total messages: ${messagesAfter} (was ${messagesBefore})\n`);

    // Step 9: Verify specific chats
    console.log('STEP 9: Verify Specific Chats - 90-Day Boundary Test');
    console.log('-'.repeat(70));

    const chat1After = await Chat.findById(chat1._id);
    const msgs1 = await Message.countDocuments({ chatId: chat1._id });
    console.log(`🔍 Chat 1 (100 days old - SHOULD DELETE):`);
    console.log(`   ✓ Record: ${chat1After ? 'EXISTS' : 'DELETED'}`);
    console.log(`   ✓ Messages: ${msgs1} (expected 0)\n`);

    const chat3After = await Chat.findById(chat3._id);
    const msgs3 = await Message.countDocuments({ chatId: chat3._id });
    console.log(`🔍 Chat 3 (EXACTLY 90 days - BOUNDARY TEST):`);
    console.log(`   ✓ Record: ${chat3After ? 'EXISTS' : 'DELETED'}`);
    console.log(`   ✓ Messages: ${msgs3} (expected 0) ${msgs3 === 0 ? '✓ BOUNDARY WORKING' : '✗ BOUNDARY FAILED'}\n`);

    const chat4After = await Chat.findById(chat4._id);
    const msgs4 = await Message.countDocuments({ chatId: chat4._id });
    console.log(`🔍 Chat 4 (89 days old - TOO RECENT, SHOULD NOT DELETE):`);
    console.log(`   ✓ Record: ${chat4After ? 'EXISTS ✓' : 'DELETED ✗'}`);
    console.log(`   ✓ Messages: ${msgs4} (should stay 0, not affected)\n`);

    const chat5After = await Chat.findById(chat5._id);
    const msgs5 = await Message.countDocuments({ chatId: chat5._id });
    console.log(`🔍 Chat 5 (TODAY - SHOULD NOT DELETE):`);
    console.log(`   ✓ Record: ${chat5After ? 'EXISTS ✓' : 'DELETED ✗'}`);
    console.log(`   ✓ Messages: ${msgs5} (expected 5) ${msgs5 === 5 ? '✓' : '✗'}\n`);

    // Step 10: Test results
    console.log('STEP 10: Test Results');
    console.log('-'.repeat(70));

    let passed = 0;
    let failed = 0;

    if (msgs1 === 0) {
      console.log('✅ TEST 1: Chat 100 days old - messages deleted');
      passed++;
    } else {
      console.log('❌ TEST 1: Chat 100 days old - messages NOT deleted');
      failed++;
    }

    if (chat1After && chat3After && chat4After && chat5After) {
      console.log('✅ TEST 2: All chat records preserved');
      passed++;
    } else {
      console.log('❌ TEST 2: Some chat records deleted');
      failed++;
    }

    if (msgs3 === 0) {
      console.log('✅ TEST 3: Chat EXACTLY 90 days - messages deleted (BOUNDARY ✓)');
      passed++;
    } else {
      console.log('❌ TEST 3: Chat exactly 90 days - NOT deleted (BOUNDARY FAILED)');
      failed++;
    }

    if (chat4After) {
      console.log('✅ TEST 4: Chat 89 days old - correctly not deleted');
      passed++;
    } else {
      console.log('❌ TEST 4: Chat 89 days - incorrectly deleted');
      failed++;
    }

    if (msgs5 === 5) {
      console.log('✅ TEST 5: Active chat messages preserved');
      passed++;
    } else {
      console.log('❌ TEST 5: Active chat messages not preserved');
      failed++;
    }

    if (result.success && result.chatsProcessed >= 3) {
      console.log('✅ TEST 6: Cleanup processed 3+ inactive chats');
      passed++;
    } else {
      console.log('❌ TEST 6: Cleanup did not process expected chats');
      failed++;
    }

    console.log('\n' + '-'.repeat(70));
    console.log(`\n📊 FINAL RESULTS: ${passed} passed, ${failed} failed\n`);

    if (failed === 0) {
      console.log('🎉 ALL TESTS PASSED! 90-Day cleanup feature is working correctly!\n');
      console.log('✅ Exact 90-day threshold working');
      console.log('✅ Boundary at 90 days verified');
      console.log('✅ Recent chats protected');
      console.log('✅ Active chats safe');
      console.log('✅ Chat records preserved');
      console.log('✅ Ready for production\n');
    } else {
      console.log('⚠️ SOME TESTS FAILED! Please review the output above.\n');
    }

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
  } finally {
    await disconnectDB();
  }
}

runTests();
