// backend/server.js
// Production AI Tag Request Assistant - Main Server

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Services
const AIAgent = require('./services/ai-agent');
const PlatformMatcher = require('./services/platform-matcher');

// Storage: Use in-memory storage (Vercel-compatible)
// Data resets when function restarts, but perfect for testing!
const InMemoryStorage = require('./services/inmemory-storage');
const storageService = new InMemoryStorage();
const historyService = storageService; // In-memory storage handles both
console.log('💾 Using in-memory storage (Vercel-compatible)');

// Initialize services
const aiAgent = new AIAgent();
const platformMatcher = new PlatformMatcher();

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Serve static files (for frontend)
app.use(express.static(__dirname));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later'
});
app.use('/api/', limiter);

// Request logging middleware
app.use(async (req, res, next) => {
  req.requestStartTime = Date.now();
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log request (async but don't wait)
  historyService.logRequest(
    req.requestId,
    req.body.userId || req.query.userId || 'anonymous',
    {
      method: req.method,
      path: req.path,
      ip: req.ip
    }
  ).catch(err => console.error('Logging error:', err));
  
  next();
});

// API Authentication middleware
const authenticateAPI = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const stats = await storageService.getStorageStats();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      storage: 'in-memory',
      services: {
        ai: !!process.env.GEMINI_API_KEY,
        storage: true,
        platforms: platformMatcher.getPlatformCount()
      },
      stats: {
        tickets: stats.ticketCount,
        history: stats.historyCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Get platform list
app.get('/api/platforms', authenticateAPI, async (req, res) => {
  try {
    const platforms = platformMatcher.getAllPlatforms();
    res.json({
      success: true,
      platforms: platforms,
      count: platforms.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Chat endpoint
app.post('/api/chat',
  authenticateAPI,
  body('message').trim().isLength({ min: 1, max: 2000 }),
  body('userId').isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { message, userId, conversationId } = req.body;

    try {
      // Log chat start
      await historyService.logAction(
        req.requestId,
        null, // no ticket yet
        userId,
        'chat_message',
        { message }
      );

      // Process with AI
      const aiStartTime = Date.now();
      const response = await aiAgent.processMessage(message, userId, conversationId);
      const aiProcessingTime = Date.now() - aiStartTime;

      // Validate extracted platform if present
      if (response.extractedData?.platform) {
        const platformMatch = platformMatcher.matchPlatform(response.extractedData.platform);
        if (platformMatch) {
          response.extractedData.platform = platformMatch.name;
          response.extractedData.platformId = platformMatch.id;
        } else {
          response.platformSuggestions = platformMatcher.suggestPlatforms(response.extractedData.platform);
        }
      }

      // Log response
      await historyService.logAction({
        requestId: req.requestId,
        userId,
        action: 'ai_response',
        data: {
          extractedData: response.extractedData,
          processingTime: aiProcessingTime
        }
      });

      res.json({
        success: true,
        ...response,
        requestId: req.requestId,
        processingTime: aiProcessingTime
      });

    } catch (error) {
      console.error('Chat error:', error);
      
      await historyService.logAction({
        requestId: req.requestId,
        userId,
        action: 'error',
        data: { error: error.message }
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Create ticket endpoint
app.post('/api/tickets/create',
  authenticateAPI,
  body('data').isObject(),
  body('userId').isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { data, userId, conversationHistory } = req.body;

    try {
      // Validate required fields
      const required = ['account', 'platform', 'tagType', 'priority'];
      const missing = required.filter(field => !data[field]);
      
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          missing: missing
        });
      }

      // Validate platform
      const platformMatch = platformMatcher.matchPlatform(data.platform);
      if (!platformMatch) {
        return res.status(400).json({
          success: false,
          error: 'Invalid platform',
          suggestions: platformMatcher.suggestPlatforms(data.platform)
        });
      }

      // Prepare ticket data
      const ticketData = {
        ...data,
        platform: platformMatch.name,
        platformId: platformMatch.id,
        requestor: userId,
        requestId: req.requestId,
        conversationHistory: conversationHistory || []
      };

      // Log ticket creation start
      await historyService.logAction({
        requestId: req.requestId,
        userId,
        action: 'ticket_creation_started',
        data: ticketData
      });

      // Create Notion ticket
      const notionStartTime = Date.now();
      const ticket = await storageService.createTicket(ticketData);
      const notionTime = Date.now() - notionStartTime;

      // Log success
      await historyService.logAction(
        req.requestId,
        ticket.id,
        userId,
        'ticket_created',
        {
          account: ticketData.account,
          platform: ticketData.platform,
          priority: ticketData.priority,
          responseTime: Date.now() - req.requestStartTime
        }
      );

      res.json({
        success: true,
        ticket: {
          id: ticket.id,
          url: ticket.url,
          title: ticket.title
        },
        requestId: req.requestId,
        processingTime: {
          total: Date.now() - req.requestStartTime,
          notion: notionTime
        }
      });

    } catch (error) {
      console.error('Ticket creation error:', error);
      
      await historyService.logAction({
        requestId: req.requestId,
        userId: req.body.userId,
        action: 'ticket_creation_failed',
        data: { error: error.message }
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get ticket history
app.get('/api/tickets/history',
  authenticateAPI,
  async (req, res) => {
    try {
      const { userId, limit = 20, offset = 0 } = req.query;
      
      const history = await historyService.getHistory({
        userId,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json({
        success: true,
        ...history
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get all tickets (file storage specific)
app.get('/api/tickets',
  authenticateAPI,
  async (req, res) => {
    try {
      const { status, requestor, platform, page, limit } = req.query;
      
      const tickets = await storageService.getTickets({
        status,
        requestor,
        platform,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20
      });

      res.json({
        success: true,
        ...tickets
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get single ticket
app.get('/api/tickets/:ticketId',
  authenticateAPI,
  async (req, res) => {
    try {
      const ticket = await storageService.getTicket(req.params.ticketId);
      
      if (!ticket) {
        return res.status(404).json({
          success: false,
          error: 'Ticket not found'
        });
      }

      res.json({
        success: true,
        ticket
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Update ticket status
app.patch('/api/tickets/:ticketId',
  authenticateAPI,
  async (req, res) => {
    try {
      const { status } = req.body;
      
      const ticket = await storageService.updateTicket(req.params.ticketId, {
        status
      });

      res.json({
        success: true,
        ticket
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Export tickets to CSV (file storage only)
app.get('/api/export/tickets',
  authenticateAPI,
  async (req, res) => {
    try {
      if (!storageService.exportTicketsCSV) {
        return res.status(501).json({
          success: false,
          error: 'CSV export not available with current storage backend'
        });
      }

      const csv = await storageService.exportTicketsCSV();
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=tickets.csv');
      res.send(csv);

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Export history to CSV (file storage only)
app.get('/api/export/history',
  authenticateAPI,
  async (req, res) => {
    try {
      if (!storageService.exportHistoryCSV) {
        return res.status(501).json({
          success: false,
          error: 'CSV export not available with current storage backend'
        });
      }

      const csv = await storageService.exportHistoryCSV();
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=history.csv');
      res.send(csv);

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get storage statistics
app.get('/api/storage/stats',
  authenticateAPI,
  async (req, res) => {
    try {
      if (!storageService.getStorageStats) {
        return res.status(501).json({
          success: false,
          error: 'Storage stats not available with current storage backend'
        });
      }

      const stats = await storageService.getStorageStats();
      
      res.json({
        success: true,
        stats
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get analytics/stats
app.get('/api/analytics',
  authenticateAPI,
  async (req, res) => {
    try {
      const { startDate, endDate, userId } = req.query;
      
      const stats = await historyService.getAnalytics({
        startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: endDate ? new Date(endDate) : new Date(),
        userId
      });

      res.json({
        success: true,
        stats
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Get turnaround stats
app.get('/api/analytics/turnaround',
  authenticateAPI,
  async (req, res) => {
    try {
      const stats = await historyService.getTurnaroundStats();
      
      res.json({
        success: true,
        turnaround: stats
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// Future: JS Tag Generation endpoint (placeholder)
app.post('/api/tags/generate',
  authenticateAPI,
  async (req, res) => {
    // Placeholder for future JS tag generation API integration
    res.status(501).json({
      success: false,
      message: 'JS Tag Generation API not yet implemented',
      placeholder: true,
      willSupport: {
        generateTag: 'POST /api/tags/generate',
        validateTag: 'POST /api/tags/validate',
        deployTag: 'POST /api/tags/deploy'
      }
    });
  }
);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  historyService.logAction({
    requestId: req.requestId,
    userId: 'system',
    action: 'unhandled_error',
    data: {
      error: error.message,
      stack: error.stack
    }
  }).catch(console.error);

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    requestId: req.requestId
  });
});

// Serve index.html at root
const path = require('path');
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server (Vercel serverless compatible)
async function start() {
  try {
    // Initialize platform matcher only
    await platformMatcher.initialize();
    
    // In-memory storage doesn't need initialization
    // It's ready immediately!

    // Only start HTTP server if not in Vercel
    if (!process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`🚀 AI Tag Request Assistant API running on port ${PORT}`);
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
        console.log(`🤖 AI Provider: ${process.env.GEMINI_API_KEY ? 'Gemini' : 'None'}`);
        console.log(`💾 Storage: In-Memory (resets on restart)`);
        console.log(`🎯 Platforms: ${platformMatcher.getPlatformCount()} loaded`);
        console.log(`\n✨ Ready to receive requests!`);
      });
    } else {
      console.log(`✓ Vercel serverless function ready`);
      console.log(`✓ ${platformMatcher.getPlatformCount()} platforms loaded`);
    }

  } catch (error) {
    console.error('Failed to start server:', error);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  }
}

start();

module.exports = app;