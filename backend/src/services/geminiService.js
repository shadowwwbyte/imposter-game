const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate a pair of similar but distinct words for the game.
 * Innocent gets one word, imposters get a related but different word.
 */
const generateGameWords = async (category = 'general') => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are generating words for an Imposter social deduction game.
    
The game mechanic: innocent players all get one word, imposter players get a SIMILAR but DIFFERENT word.
The words must be close enough that innocents can't immediately tell who the imposter is, but different enough that imposters can be caught.

Category: ${category}

Generate ONE pair of words. The words should be:
- Closely related (same category/domain)
- Similar enough to confuse (e.g., "guitar" and "ukulele", "coffee" and "espresso", "tiger" and "leopard")
- Single words or very short phrases
- Interesting and fun for a party game

Respond ONLY with valid JSON in this exact format:
{"innocentWord": "word1", "imposterWord": "word2"}

No explanation, no markdown, just the JSON.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Parse JSON response
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.innocentWord || !parsed.imposterWord) {
      throw new Error('Invalid response format');
    }

    return {
      innocentWord: parsed.innocentWord,
      imposterWord: parsed.imposterWord,
    };
  } catch (err) {
    console.error('Gemini word generation error:', err);
    // Fallback word pairs
    const fallbacks = [
      { innocentWord: 'Guitar', imposterWord: 'Ukulele' },
      { innocentWord: 'Coffee', imposterWord: 'Espresso' },
      { innocentWord: 'Tiger', imposterWord: 'Leopard' },
      { innocentWord: 'Soccer', imposterWord: 'Rugby' },
      { innocentWord: 'Piano', imposterWord: 'Keyboard' },
      { innocentWord: 'Salmon', imposterWord: 'Trout' },
      { innocentWord: 'Tulip', imposterWord: 'Daisy' },
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
};

module.exports = { generateGameWords };
