
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testRatio(ratio) {
  try {
    const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: 'a white cat',
        config: {
            numberOfImages: 1,
            aspectRatio: ratio,
            personGeneration: 'ALLOW_ADULT'
        }
    });
    console.log(ratio, 'SUCCESS');
  } catch (e) {
    console.log(ratio, 'FAILED:', e.message);
  }
}

(async () => {
  await testRatio('1:1');
  await testRatio('3:4');
  await testRatio('4:5');
  await testRatio('9:16');
  await testRatio('2:3');
})();

