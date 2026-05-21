// Mood Tracking Service - Analyzes and logs user's emotional state over time

const MOOD_KEYWORDS = {
  VERY_POSITIVE: [
    "happy",
    "excited",
    "great",
    "wonderful",
    "amazing",
    "blessed",
    "grateful",
    "khush",
    "prasann",
    "behattar",
  ],
  POSITIVE: [
    "good",
    "better",
    "okay",
    "fine",
    "content",
    "hopeful",
    "motivated",
    "badhiya",
    "theek",
    "achcha",
  ],
  NEUTRAL: [
    "normal",
    "average",
    "usual",
    "same",
    "nothing special",
    "samanya",
  ],
  NEGATIVE: [
    "sad",
    "down",
    "worried",
    "anxious",
    "stressed",
    "tired",
    "overwhelmed",
    "udaas",
    "chinta",
    "thaka",
  ],
  VERY_NEGATIVE: [
    "depressed",
    "hopeless",
    "terrible",
    "awful",
    "broken",
    "destroyed",
    "devastated",
    "nihash",
    "behas",
  ],
};

const MOOD_SCALE = {
  VERY_POSITIVE: 5,
  POSITIVE: 4,
  NEUTRAL: 3,
  NEGATIVE: 2,
  VERY_NEGATIVE: 1,
};

export const analyzeMood = (message) => {
  if (!message) return { mood: "neutral", score: 3, keywords: [] };

  const lowerMessage = message.toLowerCase();
  const detectedMoods = [];

  // Check mood keywords from strongest to weakest
  for (const keyword of MOOD_KEYWORDS.VERY_POSITIVE) {
    if (lowerMessage.includes(keyword)) {
      detectedMoods.push({ mood: "very_positive", score: 5, keyword });
    }
  }

  if (detectedMoods.length === 0) {
    for (const keyword of MOOD_KEYWORDS.POSITIVE) {
      if (lowerMessage.includes(keyword)) {
        detectedMoods.push({ mood: "positive", score: 4, keyword });
      }
    }
  }

  if (detectedMoods.length === 0) {
    for (const keyword of MOOD_KEYWORDS.NEUTRAL) {
      if (lowerMessage.includes(keyword)) {
        detectedMoods.push({ mood: "neutral", score: 3, keyword });
      }
    }
  }

  if (detectedMoods.length === 0) {
    for (const keyword of MOOD_KEYWORDS.NEGATIVE) {
      if (lowerMessage.includes(keyword)) {
        detectedMoods.push({ mood: "negative", score: 2, keyword });
      }
    }
  }

  if (detectedMoods.length === 0) {
    for (const keyword of MOOD_KEYWORDS.VERY_NEGATIVE) {
      if (lowerMessage.includes(keyword)) {
        detectedMoods.push({ mood: "very_negative", score: 1, keyword });
      }
    }
  }

  const finalMood = detectedMoods.length > 0 ? detectedMoods[0] : { mood: "neutral", score: 3, keyword: null };

  return {
    mood: finalMood.mood,
    score: finalMood.score,
    keyword: finalMood.keyword,
    detectedAt: new Date(),
  };
};

export const getMoodInsights = (moodHistory = []) => {
  if (moodHistory.length === 0) {
    return {
      averageScore: null,
      trend: "no_data",
      summary: "No mood data yet. Start logging to see insights.",
    };
  }

  const scores = moodHistory.map((m) => m.score);
  const averageScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

  let trend = "stable";
  if (moodHistory.length >= 2) {
    const recent = scores.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgOlder = scores.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(1, scores.length - 3);

    if (avgRecent > avgOlder + 0.5) {
      trend = "improving";
    } else if (avgRecent < avgOlder - 0.5) {
      trend = "declining";
    }
  }

  const moodDistribution = {
    very_positive: moodHistory.filter((m) => m.score === 5).length,
    positive: moodHistory.filter((m) => m.score === 4).length,
    neutral: moodHistory.filter((m) => m.score === 3).length,
    negative: moodHistory.filter((m) => m.score === 2).length,
    very_negative: moodHistory.filter((m) => m.score === 1).length,
  };

  return {
    averageScore,
    trend,
    moodDistribution,
    lastUpdated: moodHistory[moodHistory.length - 1]?.detectedAt,
    summary: `Your mood is ${trend}. Average mood score: ${averageScore}/5`,
  };
};

export const generateMoodReport = (moodHistory = []) => {
  const insights = getMoodInsights(moodHistory);

  return `
📊 YOUR MOOD JOURNEY

Average Mood Score: ${insights.averageScore}/5
Trend: ${insights.trend === "improving" ? "📈 Improving" : insights.trend === "declining" ? "📉 Declining" : "➡️ Stable"}

Mood Breakdown:
🌟 Very Positive: ${insights.moodDistribution.very_positive} times
😊 Positive: ${insights.moodDistribution.positive} times
😐 Neutral: ${insights.moodDistribution.neutral} times
😔 Negative: ${insights.moodDistribution.negative} times
😞 Very Negative: ${insights.moodDistribution.very_negative} times

${insights.summary}

Keep tracking to see your progress! 💙
  `;
};
