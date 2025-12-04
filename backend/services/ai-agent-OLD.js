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
      // Use Gemini 2.5 Flash - latest stable model (June 2025)
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      console.log('✓ Gemini AI initialized with model: gemini-2.5-flash');
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

Your job is to CAREFULLY collect and CONFIRM each piece of information step-by-step.

CRITICAL WORKFLOW - Follow this EXACT order:
1. First, ask for or extract the CLIENT/ACCOUNT name
2. CONFIRM the client explicitly ("Is this for [Client]?")
3. Then ask for the PLATFORM
4. CONFIRM the platform explicitly ("So this is for [Platform]?")
5. Then ask for the TAG TYPE
6. CONFIRM the tag type explicitly ("You need a [Type] tag, correct?")
7. Then ask for or infer the PRIORITY
8. CONFIRM the priority explicitly ("Priority: [Level] - is this correct?")
9. ONLY after ALL 4 fields are confirmed, offer to create the ticket

Information to extract:
- account/client: The brand/client name (e.g., Nike, SAP, Cofidis, SNCF Connect)
- platform: The advertising platform (e.g., Meta, Google DV360, The Trade Desk, Xandr)
- tagType: Type of tag (js-pixel, js-container, img-pixel)
- priority: Urgency (high, medium, low)

Important rules:
- ASK ONE QUESTION AT A TIME - never ask about multiple fields in one message
- ALWAYS confirm each field with the user before moving to the next one
- If user says "yes", "correct", "that's right" → move to next field
- If user corrects you → update that field and confirm again
- NEVER create a ticket until ALL 4 fields are explicitly confirmed
- If the user mentions "urgent", "ASAP", "high priority" → priority is "high"
- If user says "when possible", "no rush" → priority is "low"
- Otherwise default to "medium" priority

Common platform aliases you should recognize:
- Meta = Facebook, Meta Ads
- Google DV360 = DV360, Display & Video 360
- Google Ad Manager = GAM, DFP, DoubleClick
- The Trade Desk = TTD
- Xandr = AppNexus, Microsoft Advertising
- Amazon = Amazon Ads, Amazon DSP

Tag type options:
- "JS + Pixel" or "JavaScript tag" → js-pixel
- "Container tag" or "GTM" → js-container  
- "Image pixel" or "IMG tag" → img-pixel

Response style:
- Be conversational and friendly
- Confirm each field EXPLICITLY before moving on
- After confirming all 4 fields, show a summary and ask "Ready to create the ticket?"
- Don't use XML tags or code in your response
- Just talk naturally, but ALWAYS confirm each field!

Example conversation flow:
User: "urgent Nike tag for Meta"
You: "Got it! So this is for Nike, correct?"
User: "yes"
You: "Perfect! And you need this for Meta (Facebook), is that right?"
User: "yes"
You: "Great! What type of tag do you need? JS + Pixel, Container Tag, or Image Pixel?"
User: "JS pixel"
You: "A JS + Pixel tag for Meta - perfect! And I see you mentioned 'urgent', so this is HIGH priority, correct?"
User: "yes"
You: "Excellent! Let me confirm everything:
- Client: Nike ✓
- Platform: Meta ✓
- Tag Type: JS + Pixel ✓
- Priority: High ✓

Ready to create this ticket?"

REMEMBER: Confirm EACH field individually before moving to the next!`;
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

    // Only extract if AI explicitly confirms a field
    // Look for confirmation patterns like "So this is for [X]" or "Client: [X]"
    
    // Extract account/client - only if AI mentions it in a confirmation
    const knownBrands = ['nike', 'sap', 'cofidis', 'sncf', 'sncf connect', 'l\'oréal', 'loreal', 'renault', 'carrefour'];
    for (const brand of knownBrands) {
      if (combinedText.includes(brand)) {
        data.account = brand.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        break;
      }
    }

    // Try to extract capitalized words from user message as potential client names
    if (!data.account) {
      const words = userMessage.split(' ');
      for (const word of words) {
        if (word.length > 2 && word[0] === word[0].toUpperCase() && !['I', 'A', 'The', 'For', 'On', 'To'].includes(word)) {
          data.account = word;
          break;
        }
      }
    }

    // Extract platform - only if mentioned
    const platforms = {
      'Meta': ['meta', 'facebook'],
      'Google DV360': ['dv360', 'google dv360', 'display & video', 'display and video'],
      'Google Ad Manager': ['gam', 'google ad manager', 'dfp', 'doubleclick'],
      'The Trade Desk': ['trade desk', 'ttd', 'the trade desk'],
      'Xandr': ['xandr', 'appnexus'],
      'Amazon': ['amazon'],
      'Criteo': ['criteo'],
      'Taboola': ['taboola'],
      'Outbrain': ['outbrain']
    };

    for (const [platformName, aliases] of Object.entries(platforms)) {
      for (const alias of aliases) {
        if (combinedText.includes(alias)) {
          data.platform = platformName;
          break;
        }
      }
      if (data.platform) break;
    }

    // Extract tag type - only if explicitly mentioned
    if (combinedText.includes('js') && (combinedText.includes('pixel') || combinedText.includes('javascript'))) {
      data.tagType = 'JS + Pixel';
    } else if (combinedText.includes('container') || combinedText.includes('gtm')) {
      data.tagType = 'Container Tag';
    } else if (combinedText.includes('img') || combinedText.includes('image pixel')) {
      data.tagType = 'Image Pixel';
    }

    // Extract priority - be conservative, only set if explicitly mentioned or confirmed
    if (combinedText.includes('high priority') || combinedText.includes('urgent') || combinedText.includes('asap')) {
      data.priority = 'high';
    } else if (combinedText.includes('low priority') || combinedText.includes('when possible') || combinedText.includes('no rush')) {
      data.priority = 'low';
    } else if (combinedText.includes('medium') || combinedText.includes('normal priority')) {
      data.priority = 'medium';
    }
    // Don't default to medium - let AI ask for confirmation

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