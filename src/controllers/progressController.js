import Chat from "../models/chatModel.js";
import { getMoodInsights, generateMoodReport } from "../services/moodTrackingService.js";

// Get user's mood journey and insights
export const getUserMoodJourney = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Get all chat history for the user
    const chatHistory = await Chat.find({ userId }).sort({ createdAt: 1 }).select("mood crisisLevel createdAt");

    if (chatHistory.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          message: "No mood data yet. Start chatting to track your journey.",
          moodHistory: [],
          insights: null,
        },
      });
    }

    // Extract mood data
    const moodHistory = chatHistory
      .filter((chat) => chat.mood)
      .map((chat) => ({
        ...chat.mood,
        date: chat.createdAt,
      }));

    // Get insights
    const insights = getMoodInsights(moodHistory);

    res.status(200).json({
      success: true,
      data: {
        moodHistory,
        insights,
        totalChats: chatHistory.length,
        dateRange: {
          from: chatHistory[0].createdAt,
          to: chatHistory[chatHistory.length - 1].createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching mood journey:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching mood journey",
      error: error.message,
    });
  }
};

// Get mood report
export const getMoodProgressReport = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Get all chat history for the user
    const chatHistory = await Chat.find({ userId }).sort({ createdAt: 1 }).select("mood crisisLevel");

    const moodHistory = chatHistory
      .filter((chat) => chat.mood)
      .map((chat) => ({
        ...chat.mood,
      }));

    const report = generateMoodReport(moodHistory);

    res.status(200).json({
      success: true,
      data: {
        report,
        moodDataPoints: moodHistory.length,
      },
    });
  } catch (error) {
    console.error("Error generating mood report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating mood report",
      error: error.message,
    });
  }
};

// Get crisis history for user
export const getCrisisHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Get all crisis incidents for the user
    const crisisChats = await Chat.find({
      userId,
      crisisDetected: true,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        totalCrisisIncidents: crisisChats.length,
        incidents: crisisChats.map((chat) => ({
          id: chat._id,
          message: chat.userMessage.substring(0, 100) + "...",
          crisisLevel: chat.crisisLevel,
          date: chat.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching crisis history:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching crisis history",
      error: error.message,
    });
  }
};

// Get conversation summary by language
export const getConversationSummary = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Get all chats for the user
    const chatHistory = await Chat.find({ userId }).select("language");

    const languageSummary = {};
    chatHistory.forEach((chat) => {
      const lang = chat.language || "unknown";
      languageSummary[lang] = (languageSummary[lang] || 0) + 1;
    });

    res.status(200).json({
      success: true,
      data: {
        totalConversations: chatHistory.length,
        languageUsage: languageSummary,
      },
    });
  } catch (error) {
    console.error("Error getting conversation summary:", error);
    res.status(500).json({
      success: false,
      message: "Error getting conversation summary",
      error: error.message,
    });
  }
};
