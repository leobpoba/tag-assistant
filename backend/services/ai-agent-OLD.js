/**
 * AI Agent Service - Gemini Integration
 * Handles natural language processing and data extraction
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIAgent {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    
    if (!this.apiKey) {
      console.warn('⚠️ GEMINI_API_KEY not set - AI features will not work!');
      this.genAI = null;
      this.model = null;
    } else {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
    }
    
    // Conversation memory (simple in-memory store)
    this.conversations = new Map();
  }

  /**
   * Process a message and extract tag request data
   */
  async processMessage(message, userId, conversationId = null) {
    if (!this.model) {
      return {
        success: false,
        error: 'AI service not configured - GEMINI_API_KEY missing'
      };
    }

    try {
      // Get or create conversation history
      const convId = conversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let history = this.conversations.get(convId) || [];

      // Build the prompt with conversation context
      const systemPrompt = this.buildSystemPrompt();
      const fullPrompt = this.buildPromptWithHistory(systemPrompt, history, message);

      // Call Gemini API
      const result = await this.model.generateContent(fullPrompt);
      const response = result.response;
      const aiResponse = response.text();

      // Extract structured data from response
      const extractedData = this.extractData(aiResponse, message);

      // Update conversation history
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: aiResponse });
      this.conversations.set(convId, history);

      // Determine next actions
      const actions = this.determineActions(extractedData);
      const suggestions = this.generateSuggestions(extractedData);

      return {
        success: true,
        conversationId: convId,
        message: this.cleanResponse(aiResponse),
        extractedData,
        actions,
        suggestions,
        complete: this.isDataComplete(extractedData)
      };

    } catch (error) {
      console.error('AI Agent Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to process message'
      };
    }
  }

  /**
   * Build system prompt with instructions
   */
  buildSystemPrompt() {
    return `You are an AI assistant helping users create tag requests for advertising platforms.

Your job is to:
1. Extract information from natural language
2. Ask clarifying questions when needed
3. Be friendly and conversational
4. Never make assumptions - always ask!

Information to extract:
- account/client: The brand/client name (e.g., Nike, SAP, Cofidis)
- platform: The advertising platform (e.g., Meta, Google DV360, The Trade Desk)
- tagType: Type of tag (js-pixel, js-container, img-pixel, etc.)
- priority: Urgency (high, medium, low) - infer from words like "urgent", "ASAP", "when possible"

Important rules:
- If the user mentions "urgent", "ASAP", "high priority" → priority is "high"
- If platform is not clear, suggest common ones: Meta, Google DV360, GAM, The Trade Desk, Xandr
- If tag type is not mentioned, ask what type they need
- Always confirm before creating the ticket

Common platform aliases you should recognize:
- Meta = Facebook, Meta Ads
- Google DV360 = DV360, Display & Video 360
- Google Ad Manager = GAM, DFP
- The Trade Desk = TTD
- Xandr = AppNexus, Microsoft Advertising

Response format:
- Be conversational and friendly
- Ask ONE question at a time if multiple things are missing
- When you have all info, summarize and ask for confirmation
- Don't use XML tags or structured data in your response
- Just talk naturally!`;
  }

  /**
   * Build prompt with conversation history
   */
  buildPromptWithHistory(systemPrompt, history, newMessage) {
    let prompt = systemPrompt + '\n\n';
    
    // Add conversation history
    if (history.length > 0) {
      prompt += 'Previous conversation:\n';
      for (const msg of history) {
        prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      }
      prompt += '\n';
    }
    
    // Add current message
    prompt += `User: ${newMessage}\n\nAssistant: `;
    
    return prompt;
  }

  /**
   * Extract structured data from AI response
   */
  extractData(aiResponse, userMessage) {
    const data = {
      account: null,
      platform: null,
      tagType: null,
      priority: null
    };

    // Combine AI response and user message for extraction
    const combinedText = `${userMessage} ${aiResponse}`.toLowerCase();

    // Extract priority
    if (combinedText.includes('urgent') || combinedText.includes('asap') || combinedText.includes('high priority')) {
      data.priority = 'high';
    } else if (combinedText.includes('low priority') || combinedText.includes('when possible')) {
      data.priority = 'low';
    } else if (combinedText.includes('medium') || combinedText.includes('normal')) {
      data.priority = 'medium';
    }

    // Extract platform (common ones)
    const platforms = {
      'meta': ['meta', 'facebook'],
      'dv360': ['dv360', 'google dv360', 'display & video'],
      'gam': ['gam', 'google ad manager', 'dfp'],
      'thetradedesk': ['trade desk', 'ttd', 'the trade desk'],
      'xandr': ['xandr', 'appnexus'],
      'amazon': ['amazon'],
      'criteo': ['criteo'],
      'taboola': ['taboola'],
      'outbrain': ['outbrain']
    };

    for (const [platformId, aliases] of Object.entries(platforms)) {
      for (const alias of aliases) {
        if (combinedText.includes(alias)) {
          data.platform = platformId;
          break;
        }
      }
      if (data.platform) break;
    }

    // Extract tag type
    if (combinedText.includes('js') || combinedText.includes('javascript') || combinedText.includes('pixel')) {
      data.tagType = 'js-pixel';
    } else if (combinedText.includes('container')) {
      data.tagType = 'js-container';
    } else if (combinedText.includes('img') || combinedText.includes('image')) {
      data.tagType = 'img-pixel';
    }

    // Extract account/client (look for capitalized words or known brands)
    const knownBrands = ['nike', 'sap', 'cofidis', 'sncf', 'l\'oréal', 'loreal', 'renault'];
    for (const brand of knownBrands) {
      if (combinedText.includes(brand)) {
        data.account = brand.charAt(0).toUpperCase() + brand.slice(1);
        break;
      }
    }

    // Try to extract from user message directly
    if (!data.account) {
      const words = userMessage.split(' ');
      for (const word of words) {
        if (word.length > 2 && word[0] === word[0].toUpperCase() && !['I', 'A', 'The'].includes(word)) {
          data.account = word;
          break;
        }
      }
    }

    return data;
  }

  /**
   * Clean AI response for display
   */
  cleanResponse(response) {
    // Remove any XML-like tags
    let cleaned = response.replace(/<[^>]*>/g, '');
    
    // Remove markdown code blocks
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    
    // Trim whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  /**
   * Check if we have all required data
   */
  isDataComplete(data) {
    return !!(data.account && data.platform && data.tagType && data.priority);
  }

  /**
   * Determine what actions to offer
   */
  determineActions(data) {
    const actions = [];

    if (this.isDataComplete(data)) {
      actions.push({
        action: 'create',
        label: '✓ Create Ticket',
        primary: true
      });
    }

    actions.push({
      action: 'reset',
      label: '🔄 Start Over',
      primary: false
    });

    return actions;
  }

  /**
   * Generate suggestions based on context
   */
  generateSuggestions(data) {
    const suggestions = [];

    if (!data.platform) {
      suggestions.push('Meta', 'Google DV360', 'The Trade Desk');
    }

    if (!data.tagType) {
      suggestions.push('JS + Pixel', 'Container Tag', 'Image Pixel');
    }

    if (!data.priority) {
      suggestions.push('High Priority', 'Medium Priority', 'Low Priority');
    }

    return suggestions;
  }

  /**
   * Clear conversation history
   */
  clearConversation(conversationId) {
    this.conversations.delete(conversationId);
  }

  /**
   * Get conversation history
   */
  getConversation(conversationId) {
    return this.conversations.get(conversationId) || [];
  }
}

module.exports = AIAgent;