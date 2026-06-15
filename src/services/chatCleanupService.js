import Chat from '../models/Chat.js';
import Message from '../models/Message.js';

const INACTIVE_DAYS = 90; // Exactly 3 months (90 days)

/**
 * Calculate exact threshold: exactly 90 days ago
 * Returns: Date from exactly 90 days ago at current time
 * Example: If today is 2026-06-15 14:30:00, threshold is 2026-03-17 14:30:00
 */
export const getInactiveThreshold = () => {
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - INACTIVE_DAYS);
  // Precision: exact hour, minute, second (not rounded to start/end of day)
  return thresholdDate;
};

/**
 * Calculate threshold for start of 90 days ago (midnight)
 * More conservative: deletes chats inactive since start of day 90 days ago
 */
export const getInactiveThresholdMidnight = () => {
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - INACTIVE_DAYS);
  thresholdDate.setHours(0, 0, 0, 0); // Set to midnight
  return thresholdDate;
};

/**
 * Find all inactive chats (no message for EXACTLY 90+ days)
 *
 * A chat is inactive if:
 * 1. lastMessageAt is null AND startedAt is 90+ days ago, OR
 * 2. lastMessageAt exists AND is 90+ days ago
 *
 * NOT inactive if:
 * - lastMessageAt is within last 90 days
 * - status is 'closed' (already archived)
 */
export const findInactiveChats = async () => {
  try {
    const thresholdDate = getInactiveThreshold();

    console.log(`[ChatCleanup] Threshold date (exactly 90 days ago): ${thresholdDate.toISOString()}`);
    console.log(`[ChatCleanup] Timezone offset: ${thresholdDate.getTimezoneOffset()} minutes`);

    const inactiveChats = await Chat.find({
      $or: [
        // Option 1: Has lastMessageAt that is BEFORE/EQUAL to threshold (90+ days old)
        { lastMessageAt: { $lte: thresholdDate } },
        // Option 2: Never had any messages (lastMessageAt is null) AND started 90+ days ago
        {
          lastMessageAt: null,
          startedAt: { $lte: thresholdDate }
        },
      ],
      status: { $ne: 'closed' }, // Exclude already closed chats
      isActive: true, // Only active chats (optional filter)
    }).select('_id chatId userId counselorId lastMessageAt startedAt status');

    console.log(`[ChatCleanup] Found ${inactiveChats.length} chats older than 90 days`);

    return inactiveChats;
  } catch (error) {
    console.error('[ChatCleanup] Error finding inactive chats:', error);
    throw error;
  }
};

/**
 * Delete messages for a specific chat
 */
export const deleteMessagesForChat = async (chatId) => {
  try {
    const result = await Message.deleteMany({ chatId });
    return result.deletedCount;
  } catch (error) {
    console.error(`[ChatCleanup] Error deleting messages for chat ${chatId}:`, error);
    throw error;
  }
};

/**
 * Delete a chat record
 */
export const deleteChat = async (chatId) => {
  try {
    const result = await Chat.deleteOne({ _id: chatId });
    return result.deletedCount;
  } catch (error) {
    console.error(`[ChatCleanup] Error deleting chat ${chatId}:`, error);
    throw error;
  }
};

/**
 * Main cleanup function: Clear messages from inactive chats (keep chat records)
 * Returns: { success, chatsProcessed, deletedMessages, errors }
 */
export const cleanupInactiveChats = async () => {
  const startTime = Date.now();
  const results = {
    success: true,
    chatsProcessed: 0,
    deletedMessages: 0,
    errors: [],
    duration: 0,
    timestamp: new Date().toISOString(),
  };

  try {
    const thresholdDate = getInactiveThreshold();
    const today = new Date();
    const daysCalculated = Math.floor((today - thresholdDate) / (1000 * 60 * 60 * 24));

    console.log(`\n🧹 [ChatCleanup] Starting cleanup for inactive chats`);
    console.log(`   📅 Threshold: Exactly ${INACTIVE_DAYS} days (${daysCalculated}d calculated)`);
    console.log(`   📆 Today: ${today.toISOString().split('T')[0]}`);
    console.log(`   📆 Cutoff: ${thresholdDate.toISOString().split('T')[0]}`);
    console.log(`   💾 Will delete messages only - chat records will be preserved\n`);

    // Find all inactive chats
    const inactiveChats = await findInactiveChats();
    console.log(`📊 [ChatCleanup] Found ${inactiveChats.length} chats with NO messages for exactly ${INACTIVE_DAYS}+ days`);

    if (inactiveChats.length === 0) {
      console.log('✅ [ChatCleanup] No inactive chats found');
      results.duration = Date.now() - startTime;
      return results;
    }

    // Process each inactive chat
    for (const chat of inactiveChats) {
      try {
        // Calculate exact age
        const chatAge = chat.lastMessageAt
          ? Math.floor((today - new Date(chat.lastMessageAt)) / (1000 * 60 * 60 * 24))
          : Math.floor((today - new Date(chat.startedAt)) / (1000 * 60 * 60 * 24));

        console.log(`\n  📝 Chat: ${chat.chatId}`);
        console.log(`     User: ${chat.userId} | Counselor: ${chat.counselorId}`);
        console.log(`     Status: ${chat.status}`);
        console.log(`     Last activity: ${chat.lastMessageAt ? new Date(chat.lastMessageAt).toISOString().split('T')[0] : 'NEVER'} (${chatAge} days ago)`);
        console.log(`     Exceeds threshold: ${chatAge >= INACTIVE_DAYS ? '✓ YES' : '✗ NO'}`);

        // Delete messages only (keep chat record)
        const messageCount = await deleteMessagesForChat(chat._id);
        results.deletedMessages += messageCount;
        results.chatsProcessed += 1;
        console.log(`     ✓ Cleared ${messageCount} messages`);

      } catch (error) {
        const errorMsg = `Failed to cleanup chat ${chat.chatId}: ${error.message}`;
        console.error(`     ✗ ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    results.duration = Date.now() - startTime;

    // Log final summary
    console.log(`\n📈 [ChatCleanup] Cleanup completed:`);
    console.log(`   ✓ Chats processed: ${results.chatsProcessed}`);
    console.log(`   ✓ Messages deleted: ${results.deletedMessages}`);
    console.log(`   ✓ Chat records: KEPT (not deleted)`);
    if (results.errors.length > 0) {
      console.log(`   ✗ Errors: ${results.errors.length}`);
      results.success = false;
    }
    console.log(`   ⏱️  Duration: ${results.duration}ms\n`);

    return results;

  } catch (error) {
    console.error('[ChatCleanup] Fatal error during cleanup:', error);
    results.success = false;
    results.errors.push(error.message);
    results.duration = Date.now() - startTime;
    return results;
  }
};

/**
 * Get cleanup statistics without deleting
 */
export const getCleanupStats = async () => {
  try {
    const thresholdDate = getInactiveThreshold();

    const inactiveChats = await findInactiveChats();

    const messageCount = await Message.countDocuments({
      chatId: { $in: inactiveChats.map(c => c._id) }
    });

    return {
      inactiveChatsCount: inactiveChats.length,
      messagesCount: messageCount,
      inactiveThreshold: thresholdDate.toISOString(),
      thresholdDays: INACTIVE_DAYS,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[ChatCleanup] Error getting statistics:', error);
    throw error;
  }
};
