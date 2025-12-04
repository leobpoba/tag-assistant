// backend/services/platform-matcher.js
// Platform matching with aliases and fuzzy search

const fs = require('fs').promises;
const path = require('path');

class PlatformMatcher {
  constructor() {
    this.platforms = [];
    this.aliasMap = new Map();
  }

  async initialize() {
    try {
      // Load platforms from config file
      const configPath = path.join(__dirname, '../config/platforms.json');
      const data = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(data);
      
      this.platforms = config.platforms.filter(p => p.active !== false);
      
      // Build alias map for fast lookup
      this.buildAliasMap();
      
      console.log(`✓ Loaded ${this.platforms.length} platforms with ${this.aliasMap.size} aliases`);
      
    } catch (error) {
      console.error('Failed to load platforms:', error);
      // Use default platforms as fallback
      this.loadDefaultPlatforms();
    }
  }

  buildAliasMap() {
    this.aliasMap.clear();
    
    this.platforms.forEach(platform => {
      // Map main name
      const mainKey = this.normalizeString(platform.name);
      this.aliasMap.set(mainKey, platform);
      
      // Map all aliases
      if (platform.aliases && Array.isArray(platform.aliases)) {
        platform.aliases.forEach(alias => {
          const aliasKey = this.normalizeString(alias);
          this.aliasMap.set(aliasKey, platform);
        });
      }
    });
  }

  normalizeString(str) {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, ''); // Remove special characters
  }

  matchPlatform(input) {
    if (!input) return null;
    
    const normalized = this.normalizeString(input);
    
    // Try exact match first
    if (this.aliasMap.has(normalized)) {
      return this.aliasMap.get(normalized);
    }
    
    // Try fuzzy match
    const fuzzyMatch = this.fuzzyMatch(input);
    if (fuzzyMatch && fuzzyMatch.score > 0.8) {
      return fuzzyMatch.platform;
    }
    
    return null;
  }

  fuzzyMatch(input) {
    const normalized = this.normalizeString(input);
    let bestMatch = null;
    let bestScore = 0;
    
    this.platforms.forEach(platform => {
      // Check main name
      const mainScore = this.calculateSimilarity(
        normalized,
        this.normalizeString(platform.name)
      );
      
      if (mainScore > bestScore) {
        bestScore = mainScore;
        bestMatch = platform;
      }
      
      // Check aliases
      if (platform.aliases) {
        platform.aliases.forEach(alias => {
          const aliasScore = this.calculateSimilarity(
            normalized,
            this.normalizeString(alias)
          );
          
          if (aliasScore > bestScore) {
            bestScore = aliasScore;
            bestMatch = platform;
          }
        });
      }
    });
    
    return bestMatch ? { platform: bestMatch, score: bestScore } : null;
  }

  calculateSimilarity(str1, str2) {
    // Levenshtein distance-based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    // Check if shorter is contained in longer
    if (longer.includes(shorter)) {
      return 0.9; // High score for substring matches
    }
    
    const editDistance = this.levenshteinDistance(str1, str2);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  suggestPlatforms(input, limit = 5) {
    const normalized = this.normalizeString(input);
    
    // Calculate similarity scores for all platforms
    const suggestions = this.platforms.map(platform => {
      const mainScore = this.calculateSimilarity(
        normalized,
        this.normalizeString(platform.name)
      );
      
      let bestAliasScore = 0;
      if (platform.aliases) {
        platform.aliases.forEach(alias => {
          const score = this.calculateSimilarity(
            normalized,
            this.normalizeString(alias)
          );
          bestAliasScore = Math.max(bestAliasScore, score);
        });
      }
      
      return {
        platform,
        score: Math.max(mainScore, bestAliasScore)
      };
    })
    .filter(s => s.score > 0.3) // Only suggest if somewhat similar
    .sort((a, b) => {
      // Sort by score first, then by priority
      if (b.score !== a.score) return b.score - a.score;
      return (a.platform.priority || 999) - (b.platform.priority || 999);
    })
    .slice(0, limit)
    .map(s => ({
      id: s.platform.id,
      name: s.platform.name,
      score: s.score,
      aliases: s.platform.aliases
    }));
    
    return suggestions;
  }

  getAllPlatforms(activeOnly = true) {
    return this.platforms
      .filter(p => !activeOnly || p.active !== false)
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))
      .map(p => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases,
        priority: p.priority
      }));
  }

  getPlatformCount() {
    return this.platforms.length;
  }

  getPlatformById(id) {
    return this.platforms.find(p => p.id === id);
  }

  loadDefaultPlatforms() {
    // Fallback platforms if config file doesn't exist
    this.platforms = [
      {
        id: 'meta',
        name: 'Meta',
        aliases: ['Facebook', 'Meta Ads', 'FB', 'Instagram Ads'],
        active: true,
        priority: 1
      },
      {
        id: 'google-dv360',
        name: 'Google DV360',
        aliases: ['DV360', 'Google Display', 'GDN', 'Display & Video 360'],
        active: true,
        priority: 2
      },
      {
        id: 'trade-desk',
        name: 'The Trade Desk',
        aliases: ['TTD', 'TradeDesk', 'Trade Desk'],
        active: true,
        priority: 3
      },
      {
        id: 'xandr',
        name: 'Xandr',
        aliases: ['AppNexus', 'Xandr Invest', 'Xandr Monetize'],
        active: true,
        priority: 4
      },
      {
        id: 'amazon',
        name: 'Amazon DSP',
        aliases: ['Amazon', 'Amazon Advertising', 'AAP'],
        active: true,
        priority: 5
      },
      {
        id: 'tiktok',
        name: 'TikTok Ads',
        aliases: ['TikTok', 'TikTok for Business'],
        active: true,
        priority: 6
      },
      {
        id: 'linkedin',
        name: 'LinkedIn Ads',
        aliases: ['LinkedIn', 'LinkedIn Campaign Manager'],
        active: true,
        priority: 7
      },
      {
        id: 'snapchat',
        name: 'Snapchat',
        aliases: ['Snap', 'Snapchat Ads'],
        active: true,
        priority: 8
      },
      {
        id: 'pinterest',
        name: 'Pinterest',
        aliases: ['Pinterest Ads'],
        active: true,
        priority: 9
      },
      {
        id: 'reddit',
        name: 'Reddit',
        aliases: ['Reddit Ads'],
        active: true,
        priority: 10
      }
    ];
    
    this.buildAliasMap();
    console.log('✓ Loaded default platforms');
  }

  // Method to update platforms at runtime (optional)
  async updatePlatforms(newPlatforms) {
    this.platforms = newPlatforms.filter(p => p.active !== false);
    this.buildAliasMap();
    
    // Optionally save to file
    const configPath = path.join(__dirname, '../config/platforms.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ platforms: newPlatforms }, null, 2)
    );
    
    console.log(`✓ Updated platforms: ${this.platforms.length} loaded`);
  }
}

module.exports = PlatformMatcher;