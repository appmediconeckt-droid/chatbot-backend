import dotenv from 'dotenv';
import { generateAIResponse } from './src/services/aiService.js';

dotenv.config();

async function testAI() {
  console.log('Testing AI with provider:', process.env.ACTIVE_AI_PROVIDER);
  try {
    const response = await generateAIResponse('Hi, I am feeling a bit stressed today. Can you help?');
    console.log('AI Response:', response);
  } catch (error) {
    console.error('AI Test Failed:', error.message);
  }
}

testAI();
