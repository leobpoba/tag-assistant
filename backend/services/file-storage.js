// backend/services/file-storage.js
// File-based storage alternative to Notion

const fs = require('fs').promises;
const path = require('path');

class FileStorageService {
  constructor() {
    this.dataDir = path.join(__dirname, '../data');
    this.ticketsFile = path.join(this.dataDir, 'tickets.json');
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.tickets = [];
    this.history = [];
  }

  async initialize() {
    try {
      // Create data directory if it doesn't exist
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Load existing tickets
      try {
        const ticketsData = await fs.readFile(this.ticketsFile, 'utf8');
        this.tickets = JSON.parse(ticketsData);
      } catch (error) {
        // File doesn't exist yet, start with empty array
        this.tickets = [];
        await this.saveTickets();
      }
      
      // Load existing history
      try {
        const historyData = await fs.readFile(this.historyFile, 'utf8');
        this.history = JSON.parse(historyData);
      } catch (error) {
        // File doesn't exist yet, start with empty array
        this.history = [];
        await this.saveHistory();
      }
      
      console.log(`✓ File storage initialized (${this.tickets.length} tickets, ${this.history.length} history entries)`);
      
    } catch (error) {
      console.error('Failed to initialize file storage:', error);
      throw error;
    }
  }

  isReady() {
    return true; // File storage is always ready
  }

  async saveTickets() {
    await fs.writeFile(this.ticketsFile, JSON.stringify(this.tickets, null, 2));
  }

  async saveHistory() {
    await fs.writeFile(this.historyFile, JSON.stringify(this.history, null, 2));
  }

  // Create a new ticket
  async createTicket(ticketData) {
    const ticket = {
      id: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: ticketData.requestId,
      account: ticketData.account,
      platform: ticketData.platform,
      platformId: ticketData.platformId,
      tagType: ticketData.tagType,
      priority: ticketData.priority,
      requestor: ticketData.requestor,
      status: 'pending',
      
      // Optional fields
      targetElement: ticketData.targetElement || null,
      vwPercent: ticketData.vwPercent || null,
      vwSeconds: ticketData.vwSeconds || null,
      
      // Metadata
      requestTime: new Date().toISOString(),
      responseTime: null,
      conversationHistory: ticketData.conversationHistory || [],
      
      // Calculated SLA
      slaDeadline: this.calculateSLADeadline(ticketData.priority),
      
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.tickets.push(ticket);
    await this.saveTickets();
    
    return {
      id: ticket.id,
      title: `${ticket.account} - ${ticket.platform} - ${ticket.tagType}`,
      url: null // No URL for file storage
    };
  }

  calculateSLADeadline(priority) {
    const now = new Date();
    const hoursToAdd = {
      'high': 4,   // 4 hours for urgent
      'medium': 24, // 24 hours
      'low': 48     // 48 hours
    };
    
    const hours = hoursToAdd[priority] || 24;
    const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);
    
    return deadline.toISOString();
  }

  // Get tickets with filtering
  async getTickets(filters = {}) {
    let filtered = [...this.tickets];
    
    // Filter by status
    if (filters.status) {
      filtered = filtered.filter(t => t.status === filters.status);
    }
    
    // Filter by requestor
    if (filters.requestor) {
      filtered = filtered.filter(t => t.requestor === filters.requestor);
    }
    
    // Filter by platform
    if (filters.platform) {
      filtered = filtered.filter(t => t.platform === filters.platform);
    }
    
    // Filter by date range
    if (filters.startDate) {
      filtered = filtered.filter(t => new Date(t.createdAt) >= new Date(filters.startDate));
    }
    
    if (filters.endDate) {
      filtered = filtered.filter(t => new Date(t.createdAt) <= new Date(filters.endDate));
    }
    
    // Sort by date (newest first)
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const start = (page - 1) * limit;
    const end = start + limit;
    
    return {
      tickets: filtered.slice(start, end),
      total: filtered.length,
      page,
      totalPages: Math.ceil(filtered.length / limit)
    };
  }

  // Get a single ticket by ID
  async getTicket(ticketId) {
    return this.tickets.find(t => t.id === ticketId);
  }

  // Update ticket status
  async updateTicket(ticketId, updates) {
    const index = this.tickets.findIndex(t => t.id === ticketId);
    
    if (index === -1) {
      throw new Error('Ticket not found');
    }
    
    this.tickets[index] = {
      ...this.tickets[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    // If status changed to completed, set response time
    if (updates.status === 'completed' && !this.tickets[index].responseTime) {
      this.tickets[index].responseTime = new Date().toISOString();
    }
    
    await this.saveTickets();
    
    return this.tickets[index];
  }

  // Create history entry
  async createHistoryEntry(data) {
    const entry = {
      id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: data.requestId,
      ticketId: data.ticketId,
      userId: data.userId,
      action: 'completed',
      
      // Request data
      account: data.data?.account,
      platform: data.data?.platform,
      priority: data.data?.priority,
      
      // Timing metrics
      responseTime: data.responseTime,
      notionTime: data.notionTime,
      
      // Metadata
      timestamp: new Date().toISOString()
    };
    
    this.history.push(entry);
    await this.saveHistory();
    
    return entry;
  }

  // Get history with filtering
  async getHistory(options = {}) {
    let filtered = [...this.history];
    
    // Filter by user
    if (options.userId) {
      filtered = filtered.filter(h => h.userId === options.userId);
    }
    
    // Sort by date (newest first)
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Pagination
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    
    return {
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      hasMore: (offset + limit) < filtered.length
    };
  }

  // Get analytics
  async getAnalytics(options = {}) {
    const { startDate, endDate, userId } = options;
    
    // Filter history by date range
    let filtered = this.history.filter(h => {
      const timestamp = new Date(h.timestamp);
      const afterStart = !startDate || timestamp >= startDate;
      const beforeEnd = !endDate || timestamp <= endDate;
      const matchesUser = !userId || h.userId === userId;
      
      return afterStart && beforeEnd && matchesUser;
    });
    
    // Calculate stats
    const totalRequests = filtered.length;
    
    const responseTimes = filtered
      .map(h => h.responseTime)
      .filter(t => t !== null && t !== undefined);
    
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
    
    // Count by platform
    const platformCounts = {};
    filtered.forEach(h => {
      if (h.platform) {
        platformCounts[h.platform] = (platformCounts[h.platform] || 0) + 1;
      }
    });
    
    // Count by priority
    const priorityCounts = {
      'high': 0,
      'medium': 0,
      'low': 0
    };
    filtered.forEach(h => {
      if (h.priority) {
        priorityCounts[h.priority] = (priorityCounts[h.priority] || 0) + 1;
      }
    });
    
    // Count by client
    const clientCounts = {};
    filtered.forEach(h => {
      if (h.account) {
        clientCounts[h.account] = (clientCounts[h.account] || 0) + 1;
      }
    });
    
    return {
      period: {
        start: startDate?.toISOString() || 'all time',
        end: endDate?.toISOString() || 'now'
      },
      totalRequests,
      avgResponseTime,
      medianResponseTime: this.calculateMedian(responseTimes),
      fastestResponse: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
      slowestResponse: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
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
  }

  // Get turnaround statistics
  async getTurnaroundStats() {
    const responseTimes = this.history
      .map(h => ({ time: h.responseTime, priority: h.priority }))
      .filter(h => h.time > 0);
    
    const times = responseTimes.map(h => h.time);
    
    const byPriority = {};
    ['high', 'medium', 'low'].forEach(priority => {
      const priorityTimes = responseTimes
        .filter(h => h.priority === priority)
        .map(h => h.time);
      
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
      fastest: times.length > 0 ? Math.min(...times) : 0,
      slowest: times.length > 0 ? Math.max(...times) : 0,
      byPriority
    };
  }

  calculateMedian(numbers) {
    if (numbers.length === 0) return 0;
    
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  // Export tickets to CSV
  async exportTicketsCSV() {
    const headers = [
      'ID',
      'Request ID',
      'Account',
      'Platform',
      'Tag Type',
      'Priority',
      'Status',
      'Requestor',
      'Request Time',
      'Response Time',
      'SLA Deadline',
      'Created At'
    ];
    
    const rows = this.tickets.map(t => [
      t.id,
      t.requestId,
      t.account,
      t.platform,
      t.tagType,
      t.priority,
      t.status,
      t.requestor,
      t.requestTime,
      t.responseTime || '',
      t.slaDeadline,
      t.createdAt
    ]);
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csv;
  }

  // Export history to CSV
  async exportHistoryCSV() {
    const headers = [
      'ID',
      'Request ID',
      'Ticket ID',
      'User',
      'Action',
      'Account',
      'Platform',
      'Priority',
      'Response Time (ms)',
      'Timestamp'
    ];
    
    const rows = this.history.map(h => [
      h.id,
      h.requestId,
      h.ticketId,
      h.userId,
      h.action,
      h.account || '',
      h.platform || '',
      h.priority || '',
      h.responseTime || '',
      h.timestamp
    ]);
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csv;
  }

  // Get storage statistics
  async getStorageStats() {
    return {
      totalTickets: this.tickets.length,
      totalHistory: this.history.length,
      ticketsByStatus: {
        pending: this.tickets.filter(t => t.status === 'pending').length,
        in_progress: this.tickets.filter(t => t.status === 'in_progress').length,
        completed: this.tickets.filter(t => t.status === 'completed').length,
        failed: this.tickets.filter(t => t.status === 'failed').length
      },
      storageLocation: this.dataDir,
      lastTicketCreated: this.tickets.length > 0 
        ? this.tickets[this.tickets.length - 1].createdAt 
        : null
    };
  }
}

module.exports = FileStorageService;