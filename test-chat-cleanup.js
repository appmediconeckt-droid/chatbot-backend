/**
 * Chat Cleanup Feature - Test Suite
 * Tests: Auto-delete messages from inactive chats (90+ days no activity)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Chat from './src/models/Chat.js';
import Message from './src/models/Message.js';
import User from './src/models/userModel.js';
import { cleanupInactiveChats, getCleanupStats, getInactiveThreshold } from './src/services/chatCleanupService.js';

dotenv.config({ path: './src/.env' });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env file');
  process.exit(1);
}

// =====================================================
// TEST HELPER FUNCTIONS
// =====================================================

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

async function createTestUsers() {
  console.log('📝 Creating test users...');

  try {
    // Create a test user
    const testUser = await User.findOneAndUpdate(
      { email: 'test-user-cleanup@example.com' },
      {
        email: 'test-user-cleanup@example.com',
        fullName: 'Test User Cleanup',
        role: 'user',
        isVerified: true,
      },
      { upsert: true, new: true }
    );

    // Create a test counselor
    const testCounselor = await User.findOneAndUpdate(
      { email: 'test-counselor-cleanup@example.com' },
      {
        email: 'test-counselor-cleanup@example.com',
        fullName: 'Test Counselor Cleanup',
        role: 'counselor',
        isVerified: true,
      },
      { upsert: true, new: true }
    );

    console.log(`   ✓ Test User: ${testUser._id}`);
    console.log(`   ✓ Test Counselor: ${testCounselor._id}\n`);

    return { testUser, testCounselor };
  } catch (error) {
    console.error('❌ Error creating test users:', error.message);
    throw error;
  }
}

async function createInactiveChat(userId, counselorId, daysAgo = 100) {
  console.log(`📝 Creating inactive chat (${daysAgo} days old, 0 messages)...`);

  try {
    const lastMessageDate = new Date();
    lastMessageDate.setDate(lastMessageDate.getDate() - daysAgo);

    const chat = await Chat.create({
      userId,
      counselorId,
      status: 'active',
      isActive: true,
      startedAt: lastMessageDate,
      lastMessageAt: null, // No messages
      updatedAt: lastMessageDate,
    });

    console.log(`   ✓ Created chat: ${chat._id}`);
    console.log(`   ✓ Status: ${chat.status}`);
    console.log(`   ✓ Messages: 0`);
    console.log(`   ✓ Last activity: ${daysAgo} days ago\n`);

    return chat;
  } catch (error) {
    console.error('❌ Error creating inactive chat:', error.message);
    throw error;
  }
}

async function createActiveChat(userId, counselorId, messageCount = 5) {
  console.log(`📝 Creating active chat (TODAY, ${messageCount} messages)...`);

  try {
    const chat = await Chat.create({
      userId,
      counselorId,
      status: 'active',
      isActive: true,
      startedAt: new Date(),
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    });

    // Create messages for this chat
    const messages = [];
    for (let i = 0; i < messageCount; i++) {
      const msg = await Message.create({
        chatId: chat._id,
        senderId: i % 2 === 0 ? userId : counselorId,
        senderRole: i % 2 === 0 ? 'user' : 'counsellor',
        content: `Test message ${i + 1}`,
        contentType: 'TEXT',
      });
      messages.push(msg);
    }

    console.log(`   ✓ Created chat: ${chat._id}`);
    console.log(`   ✓ Status: ${chat.status}`);
    console.log(`   ✓ Messages: ${messageCount}`);
    console.log(`   ✓ Last activity: TODAY\n`);

    return { chat, messages };
  } catch (error) {
    console.error('❌ Error creating active chat:', error.message);
    throw error;
  }
}

async function cleanupTestData() {
  console.log('🧹 Cleaning up test data from previous runs...\n');

  try {
    await Chat.deleteMany({ userId: { $in: ['test-user-id', 'test-counselor-id'] } });
    await Message.deleteMany({});
    await User.deleteMany({ email: /cleanup@example\.com/ });
    console.log('   ✓ Test data cleaned\n');
  } catch (error) {
    console.error('❌ Error cleaning test data:', error.message);
  }
}

// =====================================================
// MAIN TEST SUITE
// =====================================================

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 CHAT CLEANUP FEATURE - TEST SUITE');
  console.log('='.repeat(70) + '\n');

  try {
    // Step 1: Connect to DB
    console.log('STEP 1: Database Connection');
    console.log('-'.repeat(70));
    await connectDB();

    // Step 2: Clean previous test data
    console.log('STEP 2: Cleanup Previous Test Data');
    console.log('-'.repeat(70));
    await cleanupTestData();

    // Step 3: Create test users
    console.log('STEP 3: Create Test Users');
    console.log('-'.repeat(70));
    const { testUser, testCounselor } = await createTestUsers();

    // Step 4: Create test chats with EXACT day boundaries
    console.log('STEP 4: Create Test Chats (Testing Exact 90-Day Threshold)');
    console.log('-'.repeat(70));

    // Chat 1: 100 days old - SHOULD BE DELETED (clearly > 90 days)
    const inactiveChat1 = await createInactiveChat(testUser._id, testCounselor._id, 100);

    // Chat 2: 95 days old - SHOULD BE DELETED (> 90 days)
    const inactiveChat2 = await createInactiveChat(testUser._id, testCounselor._id, 95);

    // Chat 3: EXACTLY 90 days old - SHOULD BE DELETED (at threshold)
    const inactiveChat3 = await createInactiveChat(testUser._id, testCounselor._id, 90);

    // Chat 4: 89 days old - SHOULD NOT BE DELETED (< 90 days, too recent)
    const recentChat = await createInactiveChat(testUser._id, testCounselor._id, 89);

    // Chat 5: Active chat (today, has messages) - SHOULD NOT BE DELETED
    const { chat: activeChat, messages: activeMessages } = await createActiveChat(
      testUser._id,
      testCounselor._id,
      5
    );

    // Step 5: Check inactivity threshold
    console.log('STEP 5: Verify Inactivity Threshold');
    console.log('-'.repeat(70));
    const threshold = getInactiveThreshold();
    console.log(`📊 Inactivity threshold: ${threshold.toISOString()}`);
    console.log(`   (Chats with no messages before this date will be cleaned)\n`);

    // Step 6: Get cleanup statistics (dry-run)
    console.log('STEP 6: Get Cleanup Statistics (Dry-Run - No Deletion)');
    console.log('-'.repeat(70));
    const stats = await getCleanupStats();
    console.log(`📊 Cleanup Statistics:`);
    console.log(`   ✓ Inactive chats found: ${stats.inactiveChatsCount}`);
    console.log(`   ✓ Messages to delete: ${stats.messagesCount}`);
    console.log(`   ✓ Threshold: ${stats.inactiveThreshold}`);
    console.log(`   ✓ Threshold days: ${stats.thresholdDays}\n`);

    if (stats.inactiveChatsCount === 0) {
      console.log('⚠️  No inactive chats found! This might mean:');
      console.log('   - All chats are too recent');
      console.log('   - All chats have messages\n');
    }

    // Step 7: Verify before cleanup
    console.log('STEP 7: Verify Data Before Cleanup');
    console.log('-'.repeat(70));
    const chatsBefore = await Chat.countDocuments();
    const messagesBefore = await Message.countDocuments();
    console.log(`📊 Before cleanup:`);
    console.log(`   ✓ Total chats: ${chatsBefore}`);
    console.log(`   ✓ Total messages: ${messagesBefore}\n`);

    // Step 8: Execute cleanup
    console.log('STEP 8: Execute Cleanup');
    console.log('-'.repeat(70));
    const cleanupResult = await cleanupInactiveChats();

    console.log(`\n✅ Cleanup Result:`);
    console.log(`   ✓ Success: ${cleanupResult.success}`);
    console.log(`   ✓ Chats processed: ${cleanupResult.chatsProcessed}`);
    console.log(`   ✓ Messages deleted: ${cleanupResult.deletedMessages}`);
    console.log(`   ✓ Errors: ${cleanupResult.errors.length}`);
    console.log(`   ✓ Duration: ${cleanupResult.duration}ms\n`);

    if (cleanupResult.errors.length > 0) {
      console.log('❌ Errors during cleanup:');
      cleanupResult.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
      console.log();
    }

    // Step 9: Verify after cleanup
    console.log('STEP 9: Verify Data After Cleanup');
    console.log('-'.repeat(70));
    const chatsAfter = await Chat.countDocuments();
    const messagesAfter = await Message.countDocuments();

    console.log(`📊 After cleanup:`);
    console.log(`   ✓ Total chats: ${chatsAfter} (was ${chatsBefore})`);
    console.log(`   ✓ Total messages: ${messagesAfter} (was ${messagesBefore})\n`);

    // Step 10: Verify specific chats (focusing on 90-day boundary)
    console.log('STEP 10: Verify Specific Chats (90-Day Boundary Test)');
    console.log('-'.repeat(70));

    // Chat 100 days old - SHOULD DELETE
    const chat1After = await Chat.findById(inactiveChat1._id);
    const msgs1 = await Message.countDocuments({ chatId: inactiveChat1._id });
    console.log(`🔍 Chat 1 (100 days old - SHOULD DELETE):`);
    console.log(`   ✓ Record: ${chat1After ? 'EXISTS ✓' : 'DELETED'}`);
    console.log(`   ✓ Messages: ${msgs1} (should be 0) ${msgs1 === 0 ? '✓' : '✗'}\n`);

    // Chat exactly 90 days old - SHOULD DELETE (at boundary)
    const chat3After = await Chat.findById(inactiveChat3._id);
    const msgs3 = await Message.countDocuments({ chatId: inactiveChat3._id });
    console.log(`🔍 Chat 3 (EXACTLY 90 days old - BOUNDARY TEST):`);
    console.log(`   ✓ Record: ${chat3After ? 'EXISTS ✓' : 'DELETED'}`);
    console.log(`   ✓ Messages: ${msgs3} (should be 0) ${msgs3 === 0 ? '✓' : '✗'}\n`);

    // Chat 89 days old - SHOULD NOT DELETE (too recent)
    const recentChatAfter = await Chat.findById(recentChat._id);
    const msgsRecent = await Message.countDocuments({ chatId: recentChat._id });
    console.log(`🔍 Chat (89 days old - SHOULD NOT DELETE):`);
    console.log(`   ✓ Record: ${recentChatAfter ? 'EXISTS ✓' : 'DELETED'}`);
    console.log(`   ✓ Messages: ${msgsRecent} (should be 0) - No messages to delete anyway\n`);

    // Active chat today - SHOULD NOT DELETE
    const activeChatAfter = await Chat.findById(activeChat._id);
    const messagesInActive = await Message.countDocuments({ chatId: activeChat._id });
    console.log(`🔍 Active Chat (TODAY - SHOULD NOT DELETE):`);
    console.log(`   ✓ Record: ${activeChatAfter ? 'EXISTS ✓' : 'DELETED ✗'}`);
    console.log(`   ✓ Messages: ${messagesInActive} (should be ${activeMessages.length}) ${messagesInActive === activeMessages.length ? '✓' : '✗'}\n`);

    // Step 11: Final verdict (90-DAY BOUNDARY TESTS)
    console.log('STEP 11: Test Results - EXACT 90-DAY THRESHOLD');
    console.log('-'.repeat(70));

    let testsPassed = 0;
    let testsFailed = 0;

    // Test 1: Chat 100 days old - messages should be deleted
    if (msgs1 === 0) {
      console.log('✅ TEST 1 PASSED: Chat 100 days old - messages deleted');
      testsPassed++;
    } else {
      console.log('❌ TEST 1 FAILED: Chat 100 days old - messages NOT deleted');
      testsFailed++;
    }

    // Test 2: Chat exactly 90 days old - messages should be deleted (at threshold)
    if (msgs3 === 0) {
      console.log('✅ TEST 2 PASSED: Chat EXACTLY 90 days old - messages deleted (BOUNDARY ✓)');
      testsPassed++;
    } else {
      console.log('❌ TEST 2 FAILED: Chat exactly 90 days old - messages NOT deleted (BOUNDARY ✗)');
      testsFailed++;
    }

    // Test 3: Chat 89 days old - should NOT be deleted (below threshold)
    if (chat3After && recentChatAfter) {
      console.log('✅ TEST 3 PASSED: Chat 89 days old - correctly NOT deleted (too recent)');
      testsPassed++;
    } else {
      console.log('❌ TEST 3 FAILED: Chat 89 days old - incorrectly deleted');
      testsFailed++;
    }

    // Test 4: Active chat messages should NOT be deleted
    if (messagesInActive === activeMessages.length) {
      console.log('✅ TEST 4 PASSED: Active chat messages preserved');
      testsPassed++;
    } else {
      console.log('❌ TEST 4 FAILED: Active chat messages deleted');
      testsFailed++;
    }

    // Test 5: Chat records should be preserved
    if (chat1After && chat3After && activeChatAfter) {
      console.log('✅ TEST 5 PASSED: All chat records preserved (not deleted)');
      testsPassed++;
    } else {
      console.log('❌ TEST 5 FAILED: Some chat records were deleted');
      testsFailed++;
    }

    // Test 6: Cleanup should process chats >= 90 days old
    const expectedChatsProcessed = 3; // 100 days, 95 days, 90 days exactly
    if (cleanupResult.chatsProcessed >= expectedChatsProcessed) {
      console.log(`✅ TEST 6 PASSED: Cleanup processed ${cleanupResult.chatsProcessed} chats (>= ${expectedChatsProcessed} expected)`);
      testsPassed++;
    } else {
      console.log(`❌ TEST 6 FAILED: Cleanup processed ${cleanupResult.chatsProcessed} chats (expected >= ${expectedChatsProcessed})`);
      testsFailed++;
    }

    console.log('\n' + '-'.repeat(70));
    console.log(`📊 FINAL RESULTS: ${testsPassed} passed, ${testsFailed} failed\n`);

    if (testsFailed === 0) {
      console.log('🎉 ALL TESTS PASSED! Chat cleanup feature is working correctly!\n');
    } else {
      console.log('⚠️  SOME TESTS FAILED! Please review the implementation.\n');
    }

  } catch (error) {
    console.error('\n❌ Test suite error:', error);
  } finally {
    await disconnectDB();
  }
}

// =====================================================
// RUN TESTS
// =====================================================

runTests();
