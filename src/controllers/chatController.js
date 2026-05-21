import { v4 as uuidv4 } from "uuid";
import Chat from "../models/chatModel.js";
import User from "../models/userModel.js";
import { generateAIResponse } from "../services/aiService.js";
import { detectCrisis, generateCrisisResponse, CRISIS_LEVELS_EXPORT } from "../services/crisisDetectionService.js";
import { analyzeMood, getMoodInsights, generateMoodReport } from "../services/moodTrackingService.js";
import { detectLanguage, getLanguageGreeting, getLanguageEmergencyResponse } from "../services/languageService.js";

const MAX_HISTORY_TURNS = 10;

export const chatWithAI = async (req, res) => {
  try {
    const { message, history: clientHistory } = req.body;

    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "`message` is required and must be a non-empty string",
      });
    }

    const userId = req.user?.id || req.user?._id;

    // Threading rules:
    // - Logged-in user: thread by userId (sessionId optional, ignored for lookup)
    // - Guest: thread by sessionId only (must be sent by client to continue)
    // - Neither: brand new conversation, fall back to client-provided history
    let sessionId = req.body.sessionId;
    let history = [];

    if (userId) {
      if (!sessionId) sessionId = uuidv4();
      const priorChats = await Chat.find({ userId })
        .sort({ createdAt: -1 })
        .limit(MAX_HISTORY_TURNS)
        .lean();

      history = priorChats
        .reverse()
        .flatMap((c) => [
          { role: "user", content: c.userMessage },
          { role: "assistant", content: c.aiResponse },
        ]);
    } else if (sessionId) {
      const priorChats = await Chat.find({ sessionId })
        .sort({ createdAt: -1 })
        .limit(MAX_HISTORY_TURNS)
        .lean();

      history = priorChats
        .reverse()
        .flatMap((c) => [
          { role: "user", content: c.userMessage },
          { role: "assistant", content: c.aiResponse },
        ]);
    } else {
      sessionId = uuidv4();
      if (Array.isArray(clientHistory)) history = clientHistory;
    }

    console.log("[AI-CHAT DEBUG]", {
      userId: userId?.toString(),
      sessionId,
      incomingSessionId: req.body.sessionId,
      historyTurns: history.length,
      isFirstTurn: history.length === 0,
      lastTurn: history.slice(-2),
      newMessage: message,
    });

    // Onboarding flags & known user profile data.
    // Privacy: never expose the user's real fullName to the AI.
    // Use the stored `anonymous` handle, or generate a friendly one and persist it.
    const ANIMALS = ["Sparrow", "Otter", "Tiger", "Falcon", "Panda", "Owl", "Fox", "Lynx", "Wolf", "Robin"];
    const isFirstTurn = history.length === 0;
    let knownProfile = null;
    if (userId) {
      const profile = await User.findById(userId)
        .select("anonymous age gender location locationData.current.city locationData.current.state")
        .lean();
      if (profile) {
        let anonymousName = profile.anonymous;
        if (!anonymousName) {
          anonymousName = `Friend-${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`;
          // Persist so it's stable across future chats
          await User.updateOne({ _id: userId }, { $set: { anonymous: anonymousName } });
        }
        knownProfile = {
          anonymousName,
          age: profile.age || null,
          gender: profile.gender || null,
          declaredLocation: profile.location || null,
          gpsCity: profile.locationData?.current?.city || null,
          gpsState: profile.locationData?.current?.state || null,
        };
      }
    }

    // Detect language
    const detectedLanguage = detectLanguage(message);

    // Analyze mood
    const moodAnalysis = analyzeMood(message);

    // Detect crisis
    const crisisDetection = detectCrisis(message);

    // Fetch active counsellors
    const counsellors = await User.find({ role: "counsellor" }).select(
      "fullName role specialization experience qualification aboutMe location consultationMode languages rating totalSessions",
    );
    console.log(
      `[AI-CHAT DEBUG] Loaded ${counsellors.length} counsellors:`,
      counsellors.map((c) => ({
        name: c.fullName,
        role: c.role,
        specialization: c.specialization,
      })),
    );

    // Build system instruction - INTERACTIVE, SUPPORTIVE CHATBOT STYLE
    const systemInstruction = `
${isFirstTurn ? `🚨 TOP PRIORITY — THIS IS THE FIRST MESSAGE OF THE CONVERSATION.
Your reply MUST be ONLY a warm greeting + caring onboarding questions. NO ADVICE, NO TIPS, NO COUNSELOR RECOMMENDATIONS. Follow the ONBOARDING RULE exactly.

Required format for THIS reply:
"Hi! I'm MindHelper, really glad you reached out. Before we dive in, could you tell me a little about yourself — your age, where you are right now (home, work, somewhere else?), and if you're alone or with someone? And most importantly, what's on your mind today?"

You may rephrase slightly to match the user's language and tone, but the structure (greeting + ask age + ask location/surroundings + ask their concern) MUST be present. DO NOT give tips. DO NOT diagnose. Just ask warmly.
═══════════════════════════════════════════════════════════════
` : ""}
You are MindHelper, a supportive mental health and wellbeing chat companion for Mediconeckt.
You help with mental health (stress, anxiety, sleep, relationships, mood) AND general wellbeing questions (mild physical issues, lifestyle, sexual health concerns, family problems).
Be like a good, non-judgmental friend who listens, gives practical help, and knows when to point someone to a doctor.

🔐 PRIVACY: This is an anonymous chat. NEVER ask the user for their real name. If they volunteer one, do not save or repeat it back. Refer to them as "you" or use the anonymous handle in the Known profile if shown. The user's safety and anonymity come first.

NEVER refuse to engage with a topic just because it feels sensitive (sexual health, addiction, relationship abuse, family conflict). Respond with empathy and safe, general guidance.
For any PHYSICAL/MEDICAL symptom (pain, bleeding, infection signs, persistent issues, sexual dysfunction, severe headaches, chest issues, etc.):
  1. Validate empathetically (1 line)
  2. Give SAFE general self-care tips (hydration, hygiene, rest, communication with partner, etc.)
  3. STRONGLY recommend seeing a qualified doctor / specialist (urologist, gynecologist, dermatologist, GP — whichever fits)
  4. Do NOT diagnose or name conditions. Do NOT prescribe medication.

USER CONTEXT:
- Language: ${detectedLanguage.name}
- Mood: ${moodAnalysis.mood}
- Crisis Level: ${crisisDetection.level}
- Is first turn (no prior messages): ${isFirstTurn ? "YES" : "NO"}
${knownProfile ? `- Known profile (PRIVACY: use anonymous handle only, NEVER ask for or use a real name): handle=${knownProfile.anonymousName}, age=${knownProfile.age || "?"}, gender=${knownProfile.gender || "?"}, city=${knownProfile.gpsCity || knownProfile.declaredLocation || "?"}` : "- Known profile: GUEST (no stored profile)"}

═══════════════════════════════════════════════════════════════

🟢 ONBOARDING RULE — HIGHEST PRIORITY, OVERRIDES EVERYTHING ELSE:

IF the "Is first turn" flag above says YES, you MUST reply with onboarding questions ONLY. This OVERRIDES every other rule in this prompt, including "give direct advice first." On the first turn, ASK FIRST, advise LATER.

The first-turn reply MUST contain:
  - A warm 1-line greeting ("Hi! I'm MindHelper — really glad you reached out.")
  - A short, caring paragraph that gently asks for:
      • Their age and gender
      • Where they are right now (home / work / outside) and if anyone is with them
      • What they're feeling or what's on their mind today
  - NO ADVICE, NO TIPS on the first turn. Just warm greeting + caring questions.

EXAMPLE FIRST-TURN REPLY (follow this style exactly):
"Hi! I'm MindHelper, really glad you reached out. Before we dive in, could you tell me a little about yourself — your age, where you are right now (home, work, somewhere else?), and if you're alone or with someone? And most importantly, what's on your mind today?"

IF "Is first turn" is NO (user is already in conversation):
  - Follow the normal CONVERSATION STYLE below: give DIRECT advice immediately.
  - If they shared age/gender/location/surroundings in any earlier message, USE that info to personalize tips (e.g. teen → school context, elderly → mobility-friendly tips, "I'm at work" → discreet breathing exercise, "I'm with family" → suggest a moment of privacy if needed).
  - If a critical piece of info is missing AND it would meaningfully change your advice, ask for that ONE piece naturally, then still give a partial tip.

IF the system already provides "Known profile" with real values (not "?"), do NOT re-ask those specific fields. Use what's already known. But still ask the situational ones (where they are right now, who's with them) since those change moment to moment.

AVAILABLE COUNSELORS (Recommend by NAME when user asks, or when problem is serious/ongoing):
${counsellors.length > 0
  ? counsellors.map(c => `- ${c.fullName} | Specialization: ${c.specialization?.join(", ") || "General"} | Experience: ${c.experience || "N/A"} yrs | Rating: ${c.rating || "N/A"}/5 | Qualification: ${c.qualification || "N/A"} | Languages: ${c.languages?.join(", ") || "N/A"} | Mode: ${c.consultationMode?.join(", ") || "N/A"} | Location: ${c.location || "N/A"}`).join("\n")
  : "No counselors available right now"}

═══════════════════════════════════════════════════════════════

🎯 CONVERSATION STYLE (applies AFTER the onboarding turn):

EVERY follow-up MESSAGE — give a direct, helpful answer FIRST. Do NOT lead with a clarifying question.

Structure:
1. ONE short line of validation/empathy
2. 2–3 SPECIFIC, practical tips or actions they can try right now
3. (Optional) ONE short follow-up question at the very end, only if it would help refine the next tip

Keep total response SHORT (3–5 sentences). Be warm, human, supportive.

If the conversation history shows you already gave tips on this topic, give DIFFERENT tips or go deeper — never repeat the same advice.

═══════════════════════════════════════════════════════════════

📋 EXAMPLES (notice: advice comes immediately, no upfront interrogation):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER: "I can't sleep at night"
YOU: "Sleep problems are exhausting. Try this tonight: stop screens 1 hour before bed, dim the lights, and do 4-7-8 breathing (inhale 4, hold 7, exhale 8) for a few minutes. If thoughts race, jot them in a notebook so your brain can let them go. Is it more about falling asleep or staying asleep?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER: "headache what to do"
YOU: "Headaches are draining. Try drinking a full glass of water, dimming the lights, and resting in a quiet space for 15 minutes — dehydration and screen strain are common triggers. Gently massage your temples and neck. If it lasts more than a day or feels severe, please see a doctor."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER: "how do I handle deadline pressure at work"
YOU: "Deadline stress is real. Right now: list every task, then circle the ONE that unlocks the rest — do that first. Use 25-minute focused sprints with 5-minute breaks (Pomodoro), and tell your manager early if a deadline truly isn't realistic. What's the very next task you're stuck on?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER: "suggest a counselor" / "which counselor should I see" / "I need an expert"
YOU: Pick the BEST-MATCH counselor from the AVAILABLE COUNSELORS list above based on the user's stated problem (use specialization). Reply like:
"Based on what you've shared, I'd recommend Dr. [Full Name] — they specialize in [specialization], have [X] years of experience, and a [rating]/5 rating. They speak [languages] and offer [mode] consultations. Want me to help you book a session?"

If user's problem doesn't match any specialization exactly, pick the closest general counselor and say so honestly.
If the AVAILABLE COUNSELORS list is empty, say: "No counselors are available right now, but I'm here to help — let's work through this together."
NEVER invent counselor names. Use ONLY names from the list above.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

═══════════════════════════════════════════════════════════════

💡 ALWAYS GIVE GUIDANCE LIKE:
✓ "Try this: [specific technique]"
✓ "Here's what might help: [action steps]"
✓ "Right now, do [X], then [Y]"

═══════════════════════════════════════════════════════════════

🚫 COUNSELOR RECOMMENDATION RULES — VERY IMPORTANT:

DEFAULT: Do NOT mention or suggest a counselor. Just give practical advice.

ONLY recommend a counselor when ONE of these is TRUE:
1. The user EXPLICITLY asks — e.g. "suggest a counselor", "I need a counselor", "kaun counselor", "expert chahiye", "doctor bata", "I want to talk to someone professional"
2. CRISIS-level message (self-harm, suicidal thoughts) — handled separately
3. The user explicitly says current advice isn't working and asks for professional help

DO NOT recommend a counselor when:
- User is just sharing a problem and you're giving tips
- User is asking follow-up questions about the tips
- User says "thanks" or "okay" or "tell me more"
- User asks "which one is best for me" about TIPS (not counselors)
- ANY situation where the user did not clearly ask for a counselor

If you already recommended a counselor earlier in this conversation, DO NOT recommend again unless the user explicitly asks again.

HOW TO RECOMMEND (only when the rules above are met):
- Pick ONE best-match counselor by specialization from the AVAILABLE COUNSELORS list above.
- Format: "I'd recommend [Full Name] — they specialize in [specialization], have [X] years experience, [rating]/5 rating. Want me to help you book?"
- NEVER invent counselor names. Use ONLY names from the AVAILABLE COUNSELORS list above. If that list is empty, say "No counselors are available right now."

═══════════════════════════════════════════════════════════════

✅ DO THIS:
- Validate their emotion briefly (1 line)
- Give SPECIFIC, practical, actionable tips IMMEDIATELY
- Offer 2–3 things they can try right now
- Only suggest counselor if needed
- Keep language simple and supportive
- Respond in ${detectedLanguage.name}

❌ DON'T DO THIS:
- Open with a clarifying question instead of advice
- Repeat tips you already gave earlier in this chat
- Ask 3-4 questions at once
- Use clinical or robotic language
- Make it feel like an interrogation
- Suggest a counselor unless the user explicitly asked for one (see COUNSELOR RECOMMENDATION RULES above)
- Add "want to connect with a counselor?" or similar at the end of every response

═══════════════════════════════════════════════════════════════

Your goal: Be a supportive friend who helps them feel heard, understood, and guided towards solutions.
`;

    // Handle crisis immediately
    let aiResponse;

    // First-turn onboarding: deterministic warm greeting + onboarding questions.
    // We DON'T let the AI generate this — Gemini was inconsistent, so we hard-code
    // it to guarantee every new conversation starts with the onboarding ask.
    // Crisis still takes priority over onboarding (next block).
    const isFirstTurnOnboarding =
      isFirstTurn && !(crisisDetection.isCrisis && crisisDetection.level !== "medium");

    if (isFirstTurnOnboarding) {
      const lang = detectedLanguage.code || "en";
      const greetings = {
        hi: "Hi! I'm MindHelper, really glad you reached out. Before we dive in, could you share a little about yourself — your age, and where you are right now (home, work, somewhere else)? Are you alone or with someone? And most importantly, what's on your mind today?",
        en: "Hi! I'm MindHelper, really glad you reached out. Before we dive in, could you share a little about yourself — your age, and where you are right now (home, work, somewhere else)? Are you alone or with someone? And most importantly, what's on your mind today?",
      };
      // Detect Hinglish for friendlier Hindi/English mix
      if (detectedLanguage.name === "Hindi") {
        aiResponse =
          "Hi! Main MindHelper hu, bahut khushi hui aapne yahan baat ki. Shuru karne se pehle thoda apne baare mein batayenge — aapki umar kya hai aur aap abhi kahan ho (ghar, office, ya kahin aur)? Akele ho ya kisi ke saath? Aur sabse zaroori — aaj mann mein kya chal raha hai?";
      } else {
        aiResponse = greetings[lang] || greetings.en;
      }

      // Save and return immediately, skipping Gemini.
      const chatData = {
        sessionId,
        userMessage: message,
        aiResponse,
        language: detectedLanguage.code,
        mood: moodAnalysis,
        crisisLevel: crisisDetection.level,
        crisisDetected: crisisDetection.isCrisis,
      };
      if (userId) chatData.userId = userId;
      const chat = await Chat.create(chatData);

      return res.status(200).json({
        success: true,
        data: {
          aiResponse,
          chatId: chat._id,
          sessionId,
          detectedLanguage: detectedLanguage.name,
          moodAnalysis: { mood: moodAnalysis.mood, score: moodAnalysis.score },
          crisisDetected: crisisDetection.isCrisis,
          crisisLevel: crisisDetection.level,
          onboarding: true,
        },
      });
    }

    if (crisisDetection.isCrisis && crisisDetection.level !== "medium") {
      aiResponse = generateCrisisResponse(crisisDetection.level);

      // Alert counselors about crisis
      if (crisisDetection.level === "critical") {
        const emergencyCounselors = await User.find({
          role: "counsellor",
          availability: "available",
        });
        for (const counselor of emergencyCounselors) {
          await sendCrisisAlert(counselor, message, userId);
        }
      }
    } else {
      // Generate normal AI response
      aiResponse = await generateAIResponse(
        message,
        history,
        systemInstruction,
      );
    }

    // Collapse line breaks into single spaces for a clean one-line response
    if (typeof aiResponse === "string") {
      aiResponse = aiResponse.replace(/\s*\n+\s*/g, " ").trim();
    }

    // Save to database
    const chatData = {
      sessionId,
      userMessage: message,
      aiResponse: aiResponse,
      language: detectedLanguage.code,
      mood: moodAnalysis,
      crisisLevel: crisisDetection.level,
      crisisDetected: crisisDetection.isCrisis,
    };

    if (userId) {
      chatData.userId = userId;

      // Save mood history for user
      const existingChat = await Chat.findOne({ userId }).sort({ createdAt: -1 });
      if (!existingChat?.moodHistory) {
        chatData.moodHistory = [moodAnalysis];
      }
    }

    const chat = await Chat.create(chatData);

    res.status(200).json({
      success: true,
      data: {
        aiResponse,
        chatId: chat._id,
        sessionId,
        detectedLanguage: detectedLanguage.name,
        moodAnalysis: {
          mood: moodAnalysis.mood,
          score: moodAnalysis.score,
        },
        crisisDetected: crisisDetection.isCrisis,
        crisisLevel: crisisDetection.level,
      },
    });
  } catch (error) {
    console.error("AI Chat Error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while processing your request with the AI.",
      error: error.message,
    });
  }
};

// Helper function to send crisis alert to counselors
const sendCrisisAlert = async (counselor, userMessage, userId) => {
  // Implementation for sending alerts (email, SMS, push notification)
  // This can be expanded based on your notification system
  console.log(`🚨 CRISIS ALERT: User ${userId} needs immediate help. Message: ${userMessage.substring(0, 100)}...`);
};
