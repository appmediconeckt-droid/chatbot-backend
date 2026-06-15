/**
 * Chat Cleanup Job - runs daily at 2 AM.
 * Clears messages for chats with no activity for 30+ days.
 */

import { cleanupInactiveChats } from "../services/chatCleanupService.js";

let cleanupJobScheduled = false;
let cleanupJobTimer = null;
let cleanupJobInterval = null;

const DAY_MS = 24 * 60 * 60 * 1000;

const getMsUntilNext2AM = () => {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(2, 0, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun.getTime() - now.getTime();
};

const runCleanup = async () => {
  console.log("\n" + "=".repeat(60));
  console.log(
    "[ChatCleanupJob] Scheduled cleanup started at",
    new Date().toISOString(),
  );
  console.log("=".repeat(60));

  try {
    const result = await cleanupInactiveChats();

    if (result.success) {
      console.log("[ChatCleanupJob] Cleanup completed successfully");
      console.log(`   Processed ${result.chatsProcessed} inactive chats`);
      console.log(`   Deleted ${result.deletedMessages} messages`);
      console.log(`   Duration: ${result.duration}ms`);
    } else {
      console.error("[ChatCleanupJob] Cleanup completed with errors");
      result.errors.forEach((err) => console.error(`   ${err}`));
    }
  } catch (error) {
    console.error("[ChatCleanupJob] Unexpected error during cleanup:", error);
  }

  console.log("=".repeat(60) + "\n");
};

export const initChatCleanupJob = () => {
  if (cleanupJobScheduled) {
    console.log("[ChatCleanupJob] Cleanup job already scheduled, skipping...");
    return null;
  }

  cleanupJobTimer = setTimeout(() => {
    runCleanup();
    cleanupJobInterval = setInterval(runCleanup, DAY_MS);
    cleanupJobInterval.unref?.();
  }, getMsUntilNext2AM());
  cleanupJobTimer.unref?.();

  cleanupJobScheduled = true;
  console.log("[ChatCleanupJob] Scheduled cleanup job initialized");
  console.log("   Runs every day at 2:00 AM");
  console.log("   Clears messages for chats inactive for 30+ days\n");

  return {
    stop: () => {
      if (cleanupJobTimer) clearTimeout(cleanupJobTimer);
      if (cleanupJobInterval) clearInterval(cleanupJobInterval);
      cleanupJobTimer = null;
      cleanupJobInterval = null;
      cleanupJobScheduled = false;
    },
  };
};

export const isCleanupJobScheduled = () => cleanupJobScheduled;
