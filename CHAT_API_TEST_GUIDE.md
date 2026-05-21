# Chat API Testing & Frontend Integration Guide

## ✅ STEP 1: TEST CHAT API ENDPOINT

### Endpoint Details
```
POST http://localhost:5000/api/ai-chat/send-message
Content-Type: application/json
```

### Test Request (Using Postman or cURL)

**Without Authentication (Guest):**
```json
{
  "message": "I'm feeling anxious about my job",
  "history": []
}
```

**With Authentication (Add Bearer Token):**
Header: `Authorization: Bearer YOUR_JWT_TOKEN`
```json
{
  "message": "I'm feeling anxious about my job",
  "history": []
}
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "aiResponse": "I hear you. Job anxiety can be really challenging. Let me understand your situation better...",
    "chatId": "507f1f77bcf36cd799439011",
    "detectedLanguage": "English",
    "moodAnalysis": {
      "mood": "anxious",
      "score": 4
    },
    "crisisDetected": false,
    "crisisLevel": "low"
  }
}
```

### Response Fields Explained
- **aiResponse**: The AI's compassionate response (main message)
- **chatId**: Database record ID (save this for conversation history)
- **detectedLanguage**: Detected user language (English, Hindi, Tamil, etc.)
- **moodAnalysis**: 
  - mood: Detected emotional state
  - score: 1-5 score of intensity
- **crisisDetected**: Boolean (true if user is in crisis)
- **crisisLevel**: "low", "medium", "high", or "critical"

---

## ✅ STEP 2: FRONTEND INTEGRATION

### What You Need to Update in Frontend

#### 1. **Create Chat Component** (if not exists)
```jsx
// src/components/ChatInterface.jsx
import { useState } from 'react';
import axios from 'axios';

export default function ChatInterface() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [moodInfo, setMoodInfo] = useState(null);
  const [crisisInfo, setCrisisInfo] = useState(null);

  const sendMessage = async () => {
    try {
      setLoading(true);
      
      const token = localStorage.getItem('authToken'); // Get your JWT token
      
      const res = await axios.post(
        'http://localhost:5000/api/ai-chat/send-message',
        { 
          message,
          history: [] // Add previous messages here for context
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`, // Optional if authenticated
            'Content-Type': 'application/json'
          }
        }
      );

      const { data } = res.data;
      
      // Display AI response
      setResponse(data.aiResponse);
      
      // Display mood analysis
      setMoodInfo({
        mood: data.moodAnalysis.mood,
        score: data.moodAnalysis.score
      });
      
      // Handle crisis detection
      if (data.crisisDetected) {
        setCrisisInfo({
          detected: true,
          level: data.crisisLevel
        });
      }

      setMessage('');
    } catch (error) {
      console.error('Chat error:', error);
      alert('Error sending message: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      {/* Crisis Warning (if detected) */}
      {crisisInfo?.detected && (
        <div className={`alert alert-${crisisInfo.level}`}>
          ⚠️ We detect you may be in crisis. Please contact emergency services.
        </div>
      )}

      {/* AI Response */}
      {response && (
        <div className="ai-response">
          <p>{response}</p>
        </div>
      )}

      {/* Mood Display */}
      {moodInfo && (
        <div className="mood-info">
          <p>Detected Mood: <strong>{moodInfo.mood}</strong></p>
          <p>Intensity: {moodInfo.score}/5</p>
        </div>
      )}

      {/* Input Area */}
      <div className="input-area">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Tell me what's on your mind..."
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

#### 2. **Handle Conversation History**
```jsx
const [messages, setMessages] = useState([]);

const sendMessage = async () => {
  try {
    const res = await axios.post(
      'http://localhost:5000/api/ai-chat/send-message',
      { 
        message,
        history: messages // Send previous messages
      }
    );

    // Add to conversation history
    setMessages([
      ...messages,
      { 
        role: 'user', 
        content: message 
      },
      { 
        role: 'ai', 
        content: res.data.data.aiResponse 
      }
    ]);
  } catch (error) {
    console.error('Error:', error);
  }
};
```

#### 3. **Add Styling for Crisis Alert**
```css
.alert {
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-weight: bold;
}

.alert-critical {
  background-color: #ff4444;
  color: white;
  border-left: 4px solid #cc0000;
}

.alert-high {
  background-color: #ffaa00;
  color: white;
  border-left: 4px solid #ff8800;
}

.alert-medium {
  background-color: #ffcc00;
  color: black;
  border-left: 4px solid #ffaa00;
}

.mood-info {
  background: #f0f0f0;
  padding: 10px;
  border-radius: 5px;
  margin: 10px 0;
}

.ai-response {
  background: #e8f4f8;
  padding: 15px;
  border-radius: 8px;
  margin: 10px 0;
  border-left: 3px solid #0084d0;
}
```

---

## ✅ STEP 3: TESTING CHECKLIST

### Backend Tests (Postman)
- [ ] Send message without auth (guest)
- [ ] Send message with auth (logged-in user)
- [ ] Send message that triggers mood detection
- [ ] Send message that triggers crisis detection
- [ ] Check database - verify chat saved with mood/crisis data
- [ ] Check console - verify presence reset happened on startup

### Frontend Tests (After Implementation)
- [ ] Input field accepts text
- [ ] Button sends message and shows loading state
- [ ] AI response displays correctly
- [ ] Mood analysis shows (mood + score)
- [ ] Crisis alert appears when detected
- [ ] Conversation history builds properly
- [ ] Language detection shows correct language
- [ ] Message saves to database

---

## ✅ STEP 4: ENVIRONMENT SETUP

Make sure your `.env` file has:
```
GEMINI_API_KEY=your_api_key
JWT_SECRET=your_secret
ACCESS_SECRET=your_secret
NODE_ENV=development
```

---

## ✅ STEP 5: COMMON ISSUES & FIXES

### Issue: "Cannot find module aiService"
- Check: Does `src/services/aiService.js` exist?
- If not, you need to create it with the Gemini API integration

### Issue: "CORS error" in frontend
- Make sure `http://localhost:3000` (or your frontend port) is in `allowedOrigins` in app.js

### Issue: "No crisis keywords found"
- Send a message with crisis keywords: "suicide", "hurt myself", "kill myself", "can't take it anymore"

### Issue: AI response is slow
- This is normal for first request (API initialization)
- Subsequent requests should be faster

---

## Next Steps

1. ✅ Start backend: `npm start`
2. ✅ Test with Postman first
3. ✅ Check database records
4. ✅ Build frontend component
5. ✅ Integrate with your existing UI
6. ✅ Test full flow end-to-end
