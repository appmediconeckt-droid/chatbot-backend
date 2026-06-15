import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { cleanupInactiveChats, getCleanupStats } from '../services/chatCleanupService.js';

const router = express.Router();

/**
 * GET /api/admin/cleanup/stats
 * Get statistics about inactive chats without deleting them
 * Protected: Requires authentication
 */
router.get(
  '/cleanup/stats',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'), // You can adjust roles as needed
  async (req, res) => {
    try {
      console.log(`[AdminCleanup] User ${req.user?.id} requested cleanup stats`);

      const stats = await getCleanupStats();

      return res.status(200).json({
        success: true,
        message: 'Cleanup statistics retrieved',
        data: stats,
      });

    } catch (error) {
      console.error('[AdminCleanup] Error getting cleanup stats:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get cleanup statistics',
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/cleanup/execute
 * Manually trigger chat cleanup (delete inactive chats)
 * Protected: Requires authentication
 */
router.post(
  '/cleanup/execute',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'), // You can adjust roles as needed
  async (req, res) => {
    try {
      console.log(`[AdminCleanup] User ${req.user?.id} triggered manual cleanup`);

      const result = await cleanupInactiveChats();

      const statusCode = result.success ? 200 : 206; // 206 = Partial Content (some errors)

      return res.status(statusCode).json({
        success: result.success,
        message: result.success
          ? 'Chat cleanup completed successfully'
          : 'Chat cleanup completed with some errors',
        data: {
          chatsProcessed: result.chatsProcessed,
          messagesDeleted: result.deletedMessages,
          note: 'Chat records preserved, only messages cleared',
          errors: result.errors,
          duration: result.duration,
          timestamp: result.timestamp,
        },
      });

    } catch (error) {
      console.error('[AdminCleanup] Error executing cleanup:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to execute cleanup',
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/cleanup/dry-run
 * Preview what would be deleted without actually deleting
 * Protected: Requires authentication
 */
router.post(
  '/cleanup/dry-run',
  authenticateToken,
  authorizeRoles('admin', 'superadmin'),
  async (req, res) => {
    try {
      console.log(`[AdminCleanup] User ${req.user?.id} requested cleanup dry-run`);

      const stats = await getCleanupStats();

      return res.status(200).json({
        success: true,
        message: 'Dry-run results (nothing was deleted)',
        data: {
          wouldProcess: {
            inactiveChats: stats.inactiveChatsCount,
            messagesToDelete: stats.messagesCount,
          },
          note: 'Only messages would be deleted, chat records will be preserved',
          inactiveThreshold: stats.inactiveThreshold,
          thresholdDays: stats.thresholdDays,
          timestamp: stats.lastUpdated,
        },
      });

    } catch (error) {
      console.error('[AdminCleanup] Error running dry-run:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to run dry-run',
        error: error.message,
      });
    }
  }
);

export default router;
