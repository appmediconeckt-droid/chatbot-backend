# 🧪 API Testing Examples - World-Class Chatbot

## Base URL
```
http://localhost:5000
or
https://your-production-domain.com
```

---

## 1️⃣ Chat Endpoint - Normal Conversation

### Request
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "I am feeling anxious about my job interview tomorrow",
    "history": []
  }'
```

### Response
```json
{
  "success": true,
  "data": {
    "aiResponse": "I understand how you're feeling. Job interviews can be nerve-wracking, but anxiety is completely normal. Let me help you prepare...",
    "chatId": "507f1f77bcf86cd799439011",
    "detectedLanguage": "English",
    "moodAnalysis": {
      "mood": "negative",
      "score": 2
    },
    "crisisDetected": false,
    "crisisLevel": "low"
  }
}
```

---

## 2️⃣ Chat Endpoint - Hindi Conversation

### Request
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "मेरा बॉस मुझसे बहुत बुरा व्यवहार करता है। मुझे नौकरी छोड़ देनी चाहिए क्या?",
    "history": []
  }'
```

### Response
```json
{
  "success": true,
  "data": {
    "aiResponse": "मैं आपकी स्थिति को समझता हूँ। कार्यस्थल पर अच्छे व्यवहार की अपेक्षा करना स्वाभाविक है। आइये इसे विस्तार से समझते हैं...",
    "detectedLanguage": "Hindi",
    "moodAnalysis": {
      "mood": "negative",
      "score": 2
    },
    "crisisDetected": false,
    "crisisLevel": "low"
  }
}
```

---

## 3️⃣ Chat Endpoint - Crisis Situation

### Request (CRITICAL)
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "I cannot take this pain anymore. I want to kill myself.",
    "history": []
  }'
```

### Response
```json
{
  "success": true,
  "data": {
    "aiResponse": "🚨 I can see you're in a critical situation right now. Your safety is the most important thing.\n\nIMMEDIATE HELP:\n📞 National Suicide Prevention Lifeline (India): 9152987821\n📞 iCall (24/7 Mental Health Support): 9152987821\n📞 Vandrevala Foundation: 9999 77 6666\n📞 AASRA: 9820466726\n\n✅ I'm connecting you with an emergency counselor right now. Please stay safe.",
    "detectedLanguage": "English",
    "moodAnalysis": {
      "mood": "very_negative",
      "score": 1
    },
    "crisisDetected": true,
    "crisisLevel": "critical"
  }
}
```

**Actions Taken:**
- ✅ Emergency numbers provided
- ✅ All available counselors alerted
- ✅ Crisis logged in database
- ✅ Mood tracked as very_negative

---

## 4️⃣ Chat with Conversation History

### Request
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "That really helped. I feel a bit better now.",
    "history": [
      {
        "role": "user",
        "content": "I am feeling very depressed lately"
      },
      {
        "role": "assistant",
        "content": "I'm sorry you're feeling this way. Let's explore what's causing this depression..."
      },
      {
        "role": "user",
        "content": "I lost my job last month"
      },
      {
        "role": "assistant",
        "content": "Job loss is traumatic. Many people experience depression after this..."
      }
    ]
  }'
```

### Response
```json
{
  "success": true,
  "data": {
    "aiResponse": "I'm really glad you're feeling better! Progress, even small, is important. Let's continue building on this positive momentum. Tell me more about what helped...",
    "detectedLanguage": "English",
    "moodAnalysis": {
      "mood": "neutral",
      "score": 3
    },
    "crisisDetected": false,
    "crisisLevel": "low"
  }
}
```

---

## 5️⃣ Get User Mood Journey

### Request
```bash
curl -X GET http://localhost:5000/api/progress/mood-journey \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response
```json
{
  "success": true,
  "data": {
    "moodHistory": [
      {
        "mood": "very_negative",
        "score": 1,
        "keyword": "depressed",
        "date": "2026-05-10T08:30:00Z"
      },
      {
        "mood": "negative",
        "score": 2,
        "keyword": "sad",
        "date": "2026-05-11T09:15:00Z"
      },
      {
        "mood": "neutral",
        "score": 3,
        "keyword": "okay",
        "date": "2026-05-12T10:45:00Z"
      },
      {
        "mood": "positive",
        "score": 4,
        "keyword": "better",
        "date": "2026-05-13T14:20:00Z"
      },
      {
        "mood": "positive",
        "score": 4,
        "keyword": "good",
        "date": "2026-05-14T11:00:00Z"
      }
    ],
    "insights": {
      "averageScore": "2.80",
      "trend": "improving",
      "moodDistribution": {
        "very_positive": 0,
        "positive": 2,
        "neutral": 1,
        "negative": 1,
        "very_negative": 1
      }
    },
    "totalChats": 5,
    "dateRange": {
      "from": "2026-05-10T08:30:00Z",
      "to": "2026-05-14T11:00:00Z"
    }
  }
}
```

---

## 6️⃣ Get Mood Report

### Request
```bash
curl -X GET http://localhost:5000/api/progress/mood-report \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response
```json
{
  "success": true,
  "data": {
    "report": "📊 YOUR MOOD JOURNEY\n\nAverage Mood Score: 2.80/5\nTrend: 📈 Improving\n\nMood Breakdown:\n🌟 Very Positive: 0 times\n😊 Positive: 2 times\n😐 Neutral: 1 times\n😔 Negative: 1 times\n😞 Very Negative: 1 times\n\nYour mood is improving. Average mood score: 2.80/5\n\nKeep tracking to see your progress! 💙",
    "moodDataPoints": 5
  }
}
```

---

## 7️⃣ Get Crisis History

### Request
```bash
curl -X GET http://localhost:5000/api/progress/crisis-history \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response
```json
{
  "success": true,
  "data": {
    "totalCrisisIncidents": 2,
    "incidents": [
      {
        "id": "507f1f77bcf86cd799439012",
        "message": "I want to kill myself right now, I can't take this anymore...",
        "crisisLevel": "critical",
        "date": "2026-05-10T08:30:00Z"
      },
      {
        "id": "507f1f77bcf86cd799439013",
        "message": "I was abused by my partner and I don't know what to do...",
        "crisisLevel": "high",
        "date": "2026-05-08T15:45:00Z"
      }
    ]
  }
}
```

---

## 8️⃣ Get Conversation Summary

### Request
```bash
curl -X GET http://localhost:5000/api/progress/conversation-summary \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response
```json
{
  "success": true,
  "data": {
    "totalConversations": 35,
    "languageUsage": {
      "hi": 18,
      "en": 12,
      "ta": 5
    }
  }
}
```

---

## 🔍 Testing Different Languages

### Tamil
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -d '{
    "message": "எனக்கு உயிரை விட்டு விட வேண்டும் என்ற எண்ணம் வருகிறது",
    "history": []
  }'
```

### Telugu
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -d '{
    "message": "నా జీవనం చాలా కష్టమైనది",
    "history": []
  }'
```

### Kannada
```bash
curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -d '{
    "message": "ನನಗೆ ತುಂಬಾ ಹತಾಶೆ ಉಂಟಾಗಿದೆ",
    "history": []
  }'
```

---

## 📋 Error Responses

### Unauthorized
```json
{
  "success": false,
  "message": "User not authenticated"
}
```

### Server Error
```json
{
  "success": false,
  "message": "An error occurred while processing your request with the AI.",
  "error": "Error message details"
}
```

---

## 🧪 Postman Collection Template

```json
{
  "info": {
    "name": "Mediconeckt AI Chatbot",
    "description": "World-Class Mental Health Chatbot API"
  },
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "YOUR_JWT_TOKEN",
        "type": "string"
      }
    ]
  },
  "item": [
    {
      "name": "Chat - Normal",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/ai-chat/chat-with-ai",
        "body": {
          "mode": "raw",
          "raw": "{\"message\": \"I am feeling anxious\", \"history\": []}"
        }
      }
    },
    {
      "name": "Chat - Crisis",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/ai-chat/chat-with-ai",
        "body": {
          "mode": "raw",
          "raw": "{\"message\": \"I want to kill myself\", \"history\": []}"
        }
      }
    },
    {
      "name": "Get Mood Journey",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/api/progress/mood-journey"
      }
    },
    {
      "name": "Get Mood Report",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/api/progress/mood-report"
      }
    },
    {
      "name": "Get Crisis History",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/api/progress/crisis-history"
      }
    }
  ]
}
```

---

## 🎯 Performance Benchmarks

Run these tests to verify performance:

### Response Time Test
```bash
time curl -X POST http://localhost:5000/api/ai-chat/chat-with-ai \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "history": []}'
```
Expected: < 2 seconds

### Concurrent Users Test
```bash
ab -n 100 -c 10 -p payload.json \
  -T application/json \
  http://localhost:5000/api/ai-chat/chat-with-ai
```
Expected: 90%+ success rate

---

**Last Updated:** May 14, 2026
**Version:** 1.0
**Status:** ✅ Ready for Testing
