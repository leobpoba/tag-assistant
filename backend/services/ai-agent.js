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

CRITICAL: You must follow this EXACT workflow and NEVER skip steps:

STEP 1 - Get Client:
- Ask: "Which client or brand is this tag request for?"
- Wait for user's answer
- Then ask: "So this is for [Client], correct?"
- Wait for confirmation

STEP 2 - Get Platform (only after client confirmed):
- Ask: "Which platform do you need this for? For example: Google DV360, The Trade Desk, Xandr, or Google Ad Manager?"
- Wait for user's answer
- Then ask: "Perfect! So this is for [Platform], is that right?"
- Wait for confirmation

STEP 3 - Get Tag Type (only after platform confirmed):
- Ask: "What type of tag do you need? The options are: Tracker or Video Wrapper"
- Wait for user's answer
- Then ask: "Got it, a [Type] - is that correct?"
- Wait for confirmation

STEP 4 - Get Priority (only after tag type confirmed):
- If user mentioned "urgent" or "ASAP" → Ask: "I see this is urgent, so High priority, correct?"
- If user mentioned "when possible" → Ask: "So Low priority, is that right?"
- Otherwise → Ask: "What priority should this be? Low, Medium, or High?"
- Wait for user's answer

STEP 5 - Final Confirmation (only after ALL 4 fields confirmed):
Say: "Excellent! Let me confirm everything:
- Client: [Name] ✓
- Platform: [Platform] ✓
- Tag Type: [Type] ✓
- Priority: [Level] ✓

Ready to create this ticket?"

CRITICAL RULES:
- Ask ONE question at a time
- WAIT for user confirmation before moving to next step
- If user says "no" or corrects you, accept the correction and re-confirm
- DO NOT show the summary until ALL 4 fields are individually confirmed
- DO NOT skip ahead - follow the exact order above

Information to extract:
- account/client: The brand/client name (e.g., Nike, SAP, Cofidis, SNCF Connect)
- platform: ONLY these platforms - Google DV360, The Trade Desk, Xandr, Google Ad Manager, Amazon, Criteo, Taboola, Outbrain
- tagType: ONLY "Tracker" or "Video Wrapper" 
- priority: ONLY "Low", "Medium", or "High"

Platform aliases you should recognize:
- Google DV360 = DV360, Display & Video 360
- Google Ad Manager = GAM, DFP, DoubleClick
- The Trade Desk = TTD
- Xandr = AppNexus, Microsoft Advertising
- Amazon = Amazon Ads, Amazon DSP

IMPORTANT: 
- NEVER mention Meta or Facebook as platform options
- When suggesting platforms, say: "Google DV360, The Trade Desk, Xandr, or Google Ad Manager"
- For tag types, say: "Tracker or Video Wrapper"
- For priority, say: "Low, Medium, or High"

Response style:
- Be friendly and conversational
- But ALWAYS follow the exact step-by-step workflow
- Don't rush - one field at a time
- Use the exact confirmation format in Step 5 so the system can extract the data

Example (FOLLOW THIS EXACTLY):
User: "urgent Nike tracker for DV360"
You: "Got it! So this is for Nike, correct?"
User: "yes"
You: "Perfect! And you need this for Google DV360, is that right?"
User: "yes"  
You: "Great! What type of tag do you need? Tracker or Video Wrapper?"
User: "tracker"
You: "Got it, a Tracker - is that correct?"
User: "yes"
You: "And I see you mentioned 'urgent', so High priority, correct?"
User: "yes"
You: "Excellent! Let me confirm everything:
- Client: Nike ✓
- Platform: Google DV360 ✓
- Tag Type: Tracker ✓
- Priority: High ✓

Ready to create this ticket?"

REMEMBER: Confirm EACH field individually, one at a time, in order!`;
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
  /**
   * Extract structured data from AI response
   * IMPORTANT: Only extract fields that the AI has EXPLICITLY CONFIRMED
   * Don't extract just because keywords are mentioned - look for confirmation language
   */
  extractData(aiResponse, userMessage) {
    const data = {
      account: null,
      platform: null,
      tagType: null,
      priority: null
    };

    const aiText = aiResponse.toLowerCase();
    const userText = userMessage.toLowerCase();

    // Only extract if AI is explicitly confirming or summarizing
    // Look for confirmation phrases
    const hasConfirmation = aiText.includes('confirm') || 
                           aiText.includes('let me confirm') ||
                           aiText.includes('summarize') ||
                           aiText.includes('summary') ||
                           aiText.includes('✓') ||
                           aiText.includes('ready to create');

    // If no confirmation language, don't extract anything
    // This prevents extracting fields while AI is still asking about them
    if (!hasConfirmation) {
      return data;
    }

    // Only extract fields that appear in confirmation context
    const combinedText = `${userText} ${aiText}`;

    // Extract account/client - only if AI confirms it
    if (aiText.includes('client:') || aiText.includes('account:')) {
      const knownBrands = ['nike', 'sap', 'cofidis', 'sncf', 'sncf connect', 'l\'oréal', 'loreal', 'renault', 'carrefour', 'adidas', 'puma'];
      for (const brand of knownBrands) {
        if (combinedText.includes(brand)) {
          data.account = brand.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          break;
        }
      }

      // Try capitalized words if no known brand found
      if (!data.account) {
        const words = userMessage.split(' ');
        for (const word of words) {
          if (word.length > 2 && word[0] === word[0].toUpperCase() && !['I', 'A', 'The', 'For', 'On', 'To'].includes(word)) {
            data.account = word;
            break;
          }
        }
      }
    }

    // Extract platform - only if AI confirms it
    if (aiText.includes('platform:')) {
      const platforms = {
        'Google DV360': ['dv360', 'google dv360', 'display & video', 'display and video'],
        'Google Ad Manager': ['gam', 'google ad manager', 'dfp', 'doubleclick'],
        'The Trade Desk': ['trade desk', 'ttd', 'the trade desk'],
        'Xandr': ['xandr', 'appnexus', 'microsoft advertising'],
        'Amazon': ['amazon', 'amazon dsp', 'amazon ads'],
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
    }

    // Extract tag type - only if AI confirms it
    if (aiText.includes('tag type:') || aiText.includes('type:')) {
      if (combinedText.includes('tracker') || combinedText.includes('tracking')) {
        data.tagType = 'Tracker';
      } else if (combinedText.includes('video wrapper') || combinedText.includes('wrapper') || combinedText.includes('video tag')) {
        data.tagType = 'Video Wrapper';
      }
    }

    // Extract priority - only if AI confirms it
    if (aiText.includes('priority:')) {
      if (combinedText.includes('high') || combinedText.includes('urgent') || combinedText.includes('asap')) {
        data.priority = 'High';
      } else if (combinedText.includes('low') || combinedText.includes('when possible') || combinedText.includes('no rush')) {
        data.priority = 'Low';
      } else if (combinedText.includes('medium') || combinedText.includes('normal')) {
        data.priority = 'Medium';
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
      suggestions.push('Google DV360', 'The Trade Desk', 'Xandr', 'Google Ad Manager');
    }

    if (!data.tagType) {
      suggestions.push('Tracker', 'Video Wrapper');
    }

    if (!data.priority) {
      suggestions.push('Low', 'Medium', 'High');
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