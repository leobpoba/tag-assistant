/**
 * In-Memory Storage Service - Vercel Compatible
 * Stores all data in memory (RAM) - perfect for testing and demos
 * Data resets when function restarts (typically daily on Vercel)
 */

class InMemoryStorage {
  constructor() {
    // In-memory stores
    this.tickets = new Map();
    this.history = [];
    this.requestLog = new Map(); // For tracking request times
    
    console.log('💾 Using in-memory storage (data resets on restart)');
  }

  // ============================================
  // TICKET METHODS
  // ============================================

  async createTicket(ticketData) {
    const ticket = {
      id: ticketData.id || `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: ticketData.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      account: ticketData.account || null,
      platform: ticketData.platform || null,
      platformId: ticketData.platformId || null,
      tagType: ticketData.tagType || null,
      priority: ticketData.priority || 'medium',
      status: ticketData.status || 'pending',
      requestor: ticketData.requestor || ticketData.userId || 'anonymous',
      targetElement: ticketData.targetElement || null,
      vwPercent: ticketData.vwPercent || null,
      vwSeconds: ticketData.vwSeconds || null,
      requestTime: ticketData.requestTime || new Date().toISOString(),
      responseTime: ticketData.responseTime || null,
      slaDeadline: ticketData.slaDeadline || this.calculateSLADeadline(ticketData.priority),
      conversationHistory: ticketData.conversationHistory || [],
      createdAt: ticketData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.tickets.set(ticket.id, ticket);
    
    // Log to history
    await this.logAction(ticket.requestId, ticket.id, ticket.requestor, 'created', {
      account: ticket.account,
      platform: ticket.platform,
      priority: ticket.priority
    });

    return ticket;
  }

  async getTicket(ticketId) {
    return this.tickets.get(ticketId) || null;
  }

  async listTickets(filters = {}) {
    let tickets = Array.from(this.tickets.values());

    // Apply filters
    if (filters.status) {
      tickets = tickets.filter(t => t.status === filters.status);
    }
    if (filters.priority) {
      tickets = tickets.filter(t => t.priority === filters.priority);
    }
    if (filters.platform) {
      tickets = tickets.filter(t => t.platform === filters.platform);
    }
    if (filters.account) {
      tickets = tickets.filter(t => t.account === filters.account);
    }

    // Sort by created date (newest first)
    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;

    const paginatedTickets = tickets.slice(offset, offset + limit);

    return {
      tickets: paginatedTickets,
      total: tickets.length,
      page,
      limit,
      pages: Math.ceil(tickets.length / limit)
    };
  }

  async updateTicket(ticketId, updates) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const updatedTicket = {
      ...ticket,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.tickets.set(ticketId, updatedTicket);

    // Log to history
    await this.logAction(ticket.requestId, ticketId, 'system', 'updated', updates);

    return updatedTicket;
  }

  // ============================================
  // HISTORY METHODS
  // ============================================

  async logRequest(requestId, userId, metadata = {}) {
    const startTime = Date.now();
    this.requestLog.set(requestId, { startTime, userId, metadata });
  }

  async logAction(requestId, ticketId, userId, action, metadata = {}) {
    const entry = {
      id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId,
      ticketId: ticketId || null,
      userId,
      action,
      account: metadata.account || null,
      platform: metadata.platform || null,
      priority: metadata.priority || null,
      responseTime: metadata.responseTime || null,
      timestamp: new Date().toISOString()
    };

    this.history.push(entry);

    // Keep only last 1000 entries in memory
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }

    return entry;
  }

  async getHistory(filters = {}) {
    let entries = [...this.history];

    // Apply filters
    if (filters.userId) {
      entries = entries.filter(e => e.userId === filters.userId);
    }
    if (filters.action) {
      entries = entries.filter(e => e.action === filters.action);
    }
    if (filters.ticketId) {
      entries = entries.filter(e => e.ticketId === filters.ticketId);
    }

    // Sort by timestamp (newest first)
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 100;
    const offset = (page - 1) * limit;

    return {
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      page,
      limit
    };
  }

  // ============================================
  // ANALYTICS METHODS
  // ============================================

  async getAnalytics(filters = {}) {
    const tickets = Array.from(this.tickets.values());
    
    // Filter by date range if provided
    let filteredTickets = tickets;
    if (filters.startDate) {
      filteredTickets = filteredTickets.filter(t => 
        new Date(t.createdAt) >= new Date(filters.startDate)
      );
    }
    if (filters.endDate) {
      filteredTickets = filteredTickets.filter(t => 
        new Date(t.createdAt) <= new Date(filters.endDate)
      );
    }

    // Calculate stats
    const byPlatform = {};
    const byPriority = {};
    const byClient = {};
    
    filteredTickets.forEach(ticket => {
      // By platform
      if (ticket.platform) {
        byPlatform[ticket.platform] = (byPlatform[ticket.platform] || 0) + 1;
      }
      
      // By priority
      if (ticket.priority) {
        byPriority[ticket.priority] = (byPriority[ticket.priority] || 0) + 1;
      }
      
      // By client
      if (ticket.account) {
        byClient[ticket.account] = (byClient[ticket.account] || 0) + 1;
      }
    });

    return {
      period: {
        start: filters.startDate || null,
        end: filters.endDate || null
      },
      totalRequests: filteredTickets.length,
      byPlatform,
      byPriority,
      byClient,
      topPlatforms: Object.entries(byPlatform)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
      topClients: Object.entries(byClient)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))
    };
  }

  async getTurnaroundStats() {
    const completedTickets = Array.from(this.tickets.values())
      .filter(t => t.status === 'completed' && t.responseTime);

    if (completedTickets.length === 0) {
      return {
        avgTurnaround: 0,
        medianTurnaround: 0,
        fastest: 0,
        slowest: 0,
        byPriority: {}
      };
    }

    const responseTimes = completedTickets.map(t => {
      const start = new Date(t.requestTime);
      const end = new Date(t.responseTime);
      return end - start;
    });

    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const sorted = responseTimes.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // By priority
    const byPriority = {};
    ['high', 'medium', 'low'].forEach(priority => {
      const priorityTickets = completedTickets.filter(t => t.priority === priority);
      if (priorityTickets.length > 0) {
        const times = priorityTickets.map(t => {
          const start = new Date(t.requestTime);
          const end = new Date(t.responseTime);
          return end - start;
        });
        const priorityAvg = times.reduce((a, b) => a + b, 0) / times.length;
        const prioritySorted = times.sort((a, b) => a - b);
        const priorityMedian = prioritySorted[Math.floor(prioritySorted.length / 2)];
        
        byPriority[priority] = {
          count: priorityTickets.length,
          avg: Math.round(priorityAvg),
          median: Math.round(priorityMedian)
        };
      }
    });

    return {
      avgTurnaround: Math.round(avg),
      medianTurnaround: Math.round(median),
      fastest: Math.min(...responseTimes),
      slowest: Math.max(...responseTimes),
      byPriority
    };
  }

  async getStorageStats() {
    return {
      ticketCount: this.tickets.size,
      historyCount: this.history.length,
      byStatus: {
        pending: Array.from(this.tickets.values()).filter(t => t.status === 'pending').length,
        in_progress: Array.from(this.tickets.values()).filter(t => t.status === 'in_progress').length,
        completed: Array.from(this.tickets.values()).filter(t => t.status === 'completed').length,
        failed: Array.from(this.tickets.values()).filter(t => t.status === 'failed').length
      }
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  calculateSLADeadline(priority) {
    const now = new Date();
    let hoursToAdd;

    switch (priority) {
      case 'high':
        hoursToAdd = 4;
        break;
      case 'medium':
        hoursToAdd = 24;
        break;
      case 'low':
        hoursToAdd = 48;
        break;
      default:
        hoursToAdd = 24;
    }

    now.setHours(now.getHours() + hoursToAdd);
    return now.toISOString();
  }

  // Export data (for downloading)
  async exportToJSON() {
    return {
      tickets: Array.from(this.tickets.values()),
      history: this.history,
      exportedAt: new Date().toISOString()
    };
  }
}

module.exports = InMemoryStorage;