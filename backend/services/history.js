// backend/services/history.js
// History tracking, audit trail, and analytics service

const { Client } = require('@notionhq/client');

class HistoryService {
  constructor() {
    this.notion = new Client({ auth: process.env.NOTION_TOKEN });
    this.historyDatabaseId = process.env.NOTION_HISTORY_DB_ID;
    this.requestLog = new Map(); // In-memory log for quick access
  }

  async initialize() {
    if (!this.historyDatabaseId) {
      console.warn('⚠️  NOTION_HISTORY_DB_ID not set - history tracking disabled');
      return;
    }
    console.log('✓ History service initialized');
  }

  isReady() {
    return !!this.historyDatabaseId;
  }

  // Log a request action
  async logAction(data) {
    const { requestId, userId, action, data: actionData } = data;
    
    // Store in memory
    if (!this.requestLog.has(requestId)) {
      this.requestLog.set(requestId, []);
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      data: actionData
    };
    
    this.requestLog.get(requestId).push(logEntry);
    
    // Optionally log to Notion
    if (this.isReady()) {
      try {
        await this.notion.pages.create({
          parent: { database_id: this.historyDatabaseId },
          properties: {
            'Request ID': {
              title: [{ text: { content: requestId } }]
            },
            'User': {
              rich_text: [{ text: { content: userId } }]
            },
            'Action': {
              select: { name: this.mapActionToSelect(action) }
            },
            'Timestamp': {
              date: { start: new Date().toISOString() }
            },
            'Data': {
              rich_text: [{
                text: { content: JSON.stringify(actionData, null, 2).substring(0, 2000) }
              }]
            }
          }
        });
      } catch (error) {
        console.error('Failed to log to Notion:', error.message);
        // Don't throw - logging failures shouldn't break the main flow
      }
    }
  }

  mapActionToSelect(action) {
    const actionMap = {
      'chat_message': 'Message Sent',
      'ai_response': 'AI Response',
      'ticket_creation_started': 'Ticket Started',
      'ticket_created': 'Ticket Created',
      'ticket_creation_failed': 'Failed',
      'error': 'Error'
    };
    return actionMap[action] || action;
  }

  // Log a request start
  async logRequest(data) {
    const { requestId, method, path, userId, ip } = data;
    
    this.requestLog.set(requestId, [{
      timestamp: new Date().toISOString(),
      type: 'request_start',
      method,
      path,
      userId,
      ip
    }]);
  }

  // Create history entry when ticket is created
  async createHistoryEntry(data) {
    const {
      requestId,
      ticketId,
      userId,
      data: requestData,
      responseTime,
      notionTime
    } = data;
    
    if (!this.isReady()) return;
    
    try {
      // Get all actions for this request
      const actions = this.requestLog.get(requestId) || [];
      
      // Calculate metrics
      const chatMessages = actions.filter(a => a.action === 'chat_message').length;
      const aiProcessingTime = actions
        .filter(a => a.action === 'ai_response')
        .reduce((sum, a) => sum + (a.data?.processingTime || 0), 0);
      
      await this.notion.pages.create({
        parent: { database_id: this.historyDatabaseId },
        properties: {
          'Request ID': {
            title: [{ text: { content: requestId } }]
          },
          'Ticket ID': {
            rich_text: [{ text: { content: ticketId } }]
          },
          'User': {
            rich_text: [{ text: { content: userId } }]
          },
          'Action': {
            select: { name: 'Completed' }
          },
          'Client': {
            rich_text: [{ text: { content: requestData.account || '' } }]
          },
          'Platform': {
            rich_text: [{ text: { content: requestData.platform || '' } }]
          },
          'Priority': {
            select: { name: requestData.priority ? requestData.priority.charAt(0).toUpperCase() + requestData.priority.slice(1) : 'Medium' }
          },
          'Response Time (ms)': {
            number: responseTime
          },
          'Chat Messages': {
            number: chatMessages
          },
          'AI Processing (ms)': {
            number: aiProcessingTime
          },
          'Notion Time (ms)': {
            number: notionTime
          },
          'Timestamp': {
            date: { start: new Date().toISOString() }
          },
          'Full Data': {
            rich_text: [{
              text: {
                content: JSON.stringify({
                  requestData,
                  actions: actions.slice(-10) // Last 10 actions
                }, null, 2).substring(0, 2000)
              }
            }]
          }
        }
      });
      
      // Clean up in-memory log
      this.requestLog.delete(requestId);
      
    } catch (error) {
      console.error('Failed to create history entry:', error.message);
    }
  }

  // Get history for a user
  async getHistory(options = {}) {
    const { userId, limit = 20, offset = 0 } = options;
    
    if (!this.isReady()) {
      return {
        entries: [],
        total: 0,
        hasMore: false
      };
    }
    
    try {
      const filter = userId ? {
        property: 'User',
        rich_text: { equals: userId }
      } : undefined;
      
      const response = await this.notion.databases.query({
        database_id: this.historyDatabaseId,
        filter,
        sorts: [
          { timestamp: 'Timestamp', direction: 'descending' }
        ],
        page_size: limit,
        start_cursor: offset > 0 ? undefined : undefined // Notion uses cursors
      });
      
      const entries = response.results.map(page => ({
        id: page.id,
        requestId: page.properties['Request ID']?.title[0]?.text.content,
        ticketId: page.properties['Ticket ID']?.rich_text[0]?.text.content,
        user: page.properties['User']?.rich_text[0]?.text.content,
        action: page.properties['Action']?.select?.name,
        client: page.properties['Client']?.rich_text[0]?.text.content,
        platform: page.properties['Platform']?.rich_text[0]?.text.content,
        priority: page.properties['Priority']?.select?.name,
        responseTime: page.properties['Response Time (ms)']?.number,
        timestamp: page.properties['Timestamp']?.date?.start,
        createdTime: page.created_time
      }));
      
      return {
        entries,
        total: entries.length,
        hasMore: response.has_more
      };
      
    } catch (error) {
      console.error('Failed to get history:', error.message);
      return {
        entries: [],
        total: 0,
        hasMore: false,
        error: error.message
      };
    }
  }

  // Get analytics/stats
  async getAnalytics(options = {}) {
    const { startDate, endDate, userId } = options;
    
    if (!this.isReady()) {
      return this.getDefaultStats();
    }
    
    try {
      const filter = {
        and: [
          {
            property: 'Action',
            select: { equals: 'Completed' }
          },
          {
            property: 'Timestamp',
            date: {
              on_or_after: startDate.toISOString()
            }
          },
          {
            property: 'Timestamp',
            date: {
              on_or_before: endDate.toISOString()
            }
          }
        ]
      };
      
      if (userId) {
        filter.and.push({
          property: 'User',
          rich_text: { equals: userId }
        });
      }
      
      const response = await this.notion.databases.query({
        database_id: this.historyDatabaseId,
        filter,
        page_size: 100
      });
      
      // Calculate stats
      const entries = response.results;
      const totalRequests = entries.length;
      
      const responseTimes = entries
        .map(e => e.properties['Response Time (ms)']?.number)
        .filter(t => t !== null && t !== undefined);
      
      const avgResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;
      
      const platformCounts = {};
      const priorityCounts = {};
      const clientCounts = {};
      
      entries.forEach(entry => {
        const platform = entry.properties['Platform']?.rich_text[0]?.text.content;
        const priority = entry.properties['Priority']?.select?.name;
        const client = entry.properties['Client']?.rich_text[0]?.text.content;
        
        if (platform) {
          platformCounts[platform] = (platformCounts[platform] || 0) + 1;
        }
        if (priority) {
          priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
        }
        if (client) {
          clientCounts[client] = (clientCounts[client] || 0) + 1;
        }
      });
      
      return {
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        totalRequests,
        avgResponseTime: Math.round(avgResponseTime),
        medianResponseTime: this.calculateMedian(responseTimes),
        fastestResponse: Math.min(...responseTimes),
        slowestResponse: Math.max(...responseTimes),
        byPlatform: platformCounts,
        byPriority: priorityCounts,
        byClient: clientCounts,
        topPlatforms: Object.entries(platformCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count })),
        topClients: Object.entries(clientCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }))
      };
      
    } catch (error) {
      console.error('Failed to get analytics:', error.message);
      return this.getDefaultStats();
    }
  }

  // Get turnaround statistics
  async getTurnaroundStats() {
    if (!this.isReady()) {
      return {
        avgTurnaround: 0,
        medianTurnaround: 0,
        byPriority: {}
      };
    }
    
    try {
      const response = await this.notion.databases.query({
        database_id: this.historyDatabaseId,
        filter: {
          property: 'Action',
          select: { equals: 'Completed' }
        },
        sorts: [
          { property: 'Timestamp', direction: 'descending' }
        ],
        page_size: 100
      });
      
      const turnarounds = response.results.map(entry => ({
        time: entry.properties['Response Time (ms)']?.number || 0,
        priority: entry.properties['Priority']?.select?.name
      }));
      
      const times = turnarounds.map(t => t.time).filter(t => t > 0);
      
      const byPriority = {};
      ['High', 'Medium', 'Low'].forEach(priority => {
        const priorityTimes = turnarounds
          .filter(t => t.priority === priority)
          .map(t => t.time)
          .filter(t => t > 0);
        
        byPriority[priority] = {
          count: priorityTimes.length,
          avg: priorityTimes.length > 0
            ? Math.round(priorityTimes.reduce((a, b) => a + b, 0) / priorityTimes.length)
            : 0,
          median: this.calculateMedian(priorityTimes)
        };
      });
      
      return {
        avgTurnaround: times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
        medianTurnaround: this.calculateMedian(times),
        fastest: Math.min(...times) || 0,
        slowest: Math.max(...times) || 0,
        byPriority
      };
      
    } catch (error) {
      console.error('Failed to get turnaround stats:', error.message);
      return {
        avgTurnaround: 0,
        medianTurnaround: 0,
        byPriority: {},
        error: error.message
      };
    }
  }

  calculateMedian(numbers) {
    if (numbers.length === 0) return 0;
    
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  getDefaultStats() {
    return {
      totalRequests: 0,
      avgResponseTime: 0,
      byPlatform: {},
      byPriority: {},
      byClient: {},
      topPlatforms: [],
      topClients: []
    };
  }

  // Clean up old logs (run periodically)
  cleanupOldLogs() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    
    for (const [requestId, log] of this.requestLog.entries()) {
      const firstEntry = log[0];
      if (firstEntry && new Date(firstEntry.timestamp).getTime() < cutoff) {
        this.requestLog.delete(requestId);
      }
    }
    
    console.log(`Cleaned up old logs. Current log size: ${this.requestLog.size}`);
  }
}

module.exports = HistoryService;