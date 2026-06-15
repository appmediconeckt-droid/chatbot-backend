/**
 * Chat Cleanup Job - Runs daily at 2 AM
 * Deletes inactive chats (no activity for 3+ months)
 */

import cron from 'node-cron';
import { cleanupInactiveChats } from '../services/chatCleanupService.js';

let cleanupJobScheduled = false;

/**
 * Initialize the cleanup job
 * Runs every day at 2:00 AM
 */
export const initChatCleanupJob = () => {
  if (cleanupJobScheduled) {
    console.log('[ChatCleanupJob] ⚠️ Cleanup job already scheduled, skipping...');
    return;
  }

  try {
    // Schedule: runs at 2:00 AM every day (cron: minute hour * * *)
    const job = cron.schedule('0 2 * * *', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('🔄 [ChatCleanupJob] Scheduled cleanup started at', new Date().toISOString());
      console.log('='.repeat(60));

      try {
        const result = await cleanupInactiveChats();

        // Log results
        if (result.success) {
          console.log(`✅ [ChatCleanupJob] Cleanup completed successfully`);
          console.log(`   • Deleted ${result.deletedChats} inactive chats`);
          console.log(`   • Deleted ${result.deletedMessages} messages`);
          console.log(`   • Duration: ${result.duration}ms`);
        } else {
          console.error(`❌ [ChatCleanupJob] Cleanup completed with errors`);
          if (result.errors.length > 0) {
            result.errors.forEach(err => console.error(`   • ${err}`));
          }
        }

      } catch (error) {
        console.error('[ChatCleanupJob] Unexpected error during cleanup:', error);
      }

      console.log('='.repeat(60) + '\n');
    });

    cleanupJobScheduled = true;
    console.log('✅ [ChatCleanupJob] Scheduled cleanup job initialized');
    console.log('   🕐 Runs every day at 2:00 AM');
    console.log('   ⏳ Clears chats inactive for 90+ days\n');

    return job;

  } catch (error) {
    console.error('[ChatCleanupJob] Failed to schedule cleanup job:', error);
    throw error;
  }
};

/**
 * Check if job is scheduled
 */
export const isCleanupJobScheduled = () => cleanupJobScheduled;
