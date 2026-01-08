/**
 * Tower of Madness - Multiplayer System (Clock-Based Sync)
 * 
 * Uses REAL-WORLD TIME for round synchronization:
 * - Rounds are 7 minutes, synced to UTC clock
 * - All players worldwide are in the same round
 * - Tower generated deterministically from round number
 * - Works even without server connection (fallback)
 */

// Polyfill XMLHttpRequest for Decentraland environment (colyseus.js needs it)
if (typeof (globalThis as any).XMLHttpRequest === 'undefined') {
  (globalThis as any).XMLHttpRequest = class XMLHttpRequest {
    public readyState: number = 0
    public status: number = 0
    public statusText: string = ''
    public responseText: string = ''
    public response: any = null
    public responseType: string = ''
    public onreadystatechange: (() => void) | null = null
    public onload: (() => void) | null = null
    public onerror: ((e: any) => void) | null = null
    
    private method: string = 'GET'
    private url: string = ''
    private headers: Record<string, string> = {}
    private async: boolean = true
    
    open(method: string, url: string, async: boolean = true) {
      this.method = method
      this.url = url
      this.async = async
      this.readyState = 1
    }
    
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value
    }
    
    send(body?: string | null) {
      this.readyState = 2
      
      // Use fetch if available
      const fetchFn = (globalThis as any).fetch
      if (fetchFn) {
        fetchFn(this.url, {
          method: this.method,
          headers: this.headers,
          body: body
        })
        .then((response: any) => {
          this.status = response.status
          this.statusText = response.statusText
          this.readyState = 3
          return response.text()
        })
        .then((text: string) => {
          this.responseText = text
          this.response = text
          this.readyState = 4
          if (this.onreadystatechange) this.onreadystatechange()
          if (this.onload) this.onload()
        })
        .catch((error: any) => {
          this.readyState = 4
          this.status = 0
          if (this.onerror) this.onerror(error)
          if (this.onreadystatechange) this.onreadystatechange()
        })
      } else {
        // No fetch available, fail gracefully
        console.log('[XMLHttpRequest polyfill] fetch not available')
        this.readyState = 4
        this.status = 0
        if (this.onerror) this.onerror(new Error('fetch not available'))
        if (this.onreadystatechange) this.onreadystatechange()
      }
    }
    
    abort() {
      this.readyState = 0
    }
    
    getResponseHeader(name: string): string | null {
      return null
    }
    
    getAllResponseHeaders(): string {
      return ''
    }
  }
  console.log('[Multiplayer] XMLHttpRequest polyfill installed')
}

// Polyfill URL class for Decentraland environment (colyseus.js needs it)
if (typeof (globalThis as any).URL === 'undefined') {
  (globalThis as any).URL = class URL {
    href: string
    protocol: string
    host: string
    hostname: string
    port: string
    pathname: string
    search: string
    hash: string
    
    constructor(url: string, base?: string) {
      // Simple URL parser for WebSocket URLs
      let fullUrl = url
      if (base && !url.startsWith('ws://') && !url.startsWith('wss://') && !url.startsWith('http')) {
        fullUrl = base + url
      }
      
      this.href = fullUrl
      
      // Parse protocol
      const protocolMatch = fullUrl.match(/^(wss?|https?):\/\//)
      this.protocol = protocolMatch ? protocolMatch[1] + ':' : 'wss:'
      
      // Remove protocol for parsing
      let rest = fullUrl.replace(/^(wss?|https?):\/\//, '')
      
      // Parse hash
      const hashIndex = rest.indexOf('#')
      if (hashIndex !== -1) {
        this.hash = rest.substring(hashIndex)
        rest = rest.substring(0, hashIndex)
      } else {
        this.hash = ''
      }
      
      // Parse search/query
      const searchIndex = rest.indexOf('?')
      if (searchIndex !== -1) {
        this.search = rest.substring(searchIndex)
        rest = rest.substring(0, searchIndex)
      } else {
        this.search = ''
      }
      
      // Parse pathname
      const pathIndex = rest.indexOf('/')
      if (pathIndex !== -1) {
        this.pathname = rest.substring(pathIndex)
        rest = rest.substring(0, pathIndex)
      } else {
        this.pathname = '/'
      }
      
      // Parse host and port
      const portIndex = rest.indexOf(':')
      if (portIndex !== -1) {
        this.hostname = rest.substring(0, portIndex)
        this.port = rest.substring(portIndex + 1)
      } else {
        this.hostname = rest
        this.port = ''
      }
      
      this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname
    }
    
    toString() {
      return this.href
    }
  }
  console.log('[Multiplayer] URL polyfill installed')
}

// @ts-ignore - Colyseus import
import * as Colyseus from 'colyseus.js'

// Declare globals that may not exist in all environments
declare const window: { location?: { search: string } } | undefined

// ============================================
// CONSTANTS (Must match server!)
// ============================================

const ROUND_DURATION = 420 // 7 minutes in seconds
const BREAK_DURATION = 10  // 10 seconds break
const TOTAL_CYCLE = ROUND_DURATION + BREAK_DURATION // 430 seconds

const CHUNK_OPTIONS = ['Chunk01', 'Chunk02', 'Chunk03']
const MIN_CHUNKS = 3
const MAX_CHUNKS = 8

// ============================================
// TYPE DEFINITIONS
// ============================================

export type LeaderboardEntry = {
  address: string
  displayName: string
  maxHeight: number
  bestTime: number
  isFinished: boolean
  finishOrder: number
}

export type WinnerEntry = {
  address: string
  displayName: string
  time: number
  height: number
  rank: number
}

export interface RoundInfo {
  roundNumber: number
  isBreak: boolean
  remainingTime: number
  chunkIds: string[]
}

// ============================================
// SEEDED RANDOM (Same as server!)
// ============================================

class SeededRandom {
  private seed: number
  
  constructor(seed: number) {
    this.seed = seed
  }
  
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }
  
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }
}

// ============================================
// CLOCK-BASED ROUND CALCULATION
// ============================================

/**
 * Calculate current round info from wall clock
 * This runs locally - no server needed!
 */
export function getCurrentRoundInfo(): RoundInfo {
  const now = Math.floor(Date.now() / 1000)
  const roundNumber = Math.floor(now / TOTAL_CYCLE)
  const cycleProgress = now % TOTAL_CYCLE
  
  const isBreak = cycleProgress >= ROUND_DURATION
  const remainingTime = isBreak 
    ? TOTAL_CYCLE - cycleProgress 
    : ROUND_DURATION - cycleProgress
  
  // Generate tower deterministically
  const chunkIds = generateTowerForRound(roundNumber)
  
  return {
    roundNumber,
    isBreak,
    remainingTime,
    chunkIds
  }
}

/**
 * Generate tower chunks from round number (same as server!)
 */
function generateTowerForRound(roundNumber: number): string[] {
  const rng = new SeededRandom(roundNumber)
  const numChunks = rng.nextInt(MIN_CHUNKS, MAX_CHUNKS)
  
  const chunks: string[] = []
  for (let i = 0; i < numChunks; i++) {
    const chunkIndex = rng.nextInt(0, CHUNK_OPTIONS.length - 1)
    chunks.push(CHUNK_OPTIONS[chunkIndex])
  }
  
  return chunks
}

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_SERVER_URL = 'ws://localhost:2567'

function getServerUrl(): string {
  try {
    if (typeof window !== 'undefined' && window && window.location) {
      const URLSearchParamsClass = (globalThis as any).URLSearchParams
      if (URLSearchParamsClass) {
        const params = new URLSearchParamsClass(window.location.search)
        const serverUrl = params.get('server')
        if (serverUrl) {
          console.log(`[Multiplayer] Using server from URL: ${serverUrl}`)
          return serverUrl
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  
  // Production URL
  return 'wss://towerofmadness-production.up.railway.app'
}

// ============================================
// STATE
// ============================================

let client: any = null
let room: any = null
let multiplayerInitialized = false
let connectionFailed = false
let currentRoundNumber = -1

// Callbacks
let onServerTowerReadyCallback: ((chunks: string[]) => void) | null = null
let onTimerUpdateCallback: ((remaining: number, multiplier: number) => void) | null = null
let onLeaderboardUpdateCallback: ((players: LeaderboardEntry[]) => void) | null = null
let onGameEndedCallback: ((winners: WinnerEntry[]) => void) | null = null
let onRoundChangedCallback: ((roundInfo: RoundInfo) => void) | null = null

// ============================================
// LOCAL CLOCK SYNC (Works without server!)
// ============================================

let localClockActive = false
let lastClockCheck = 0

/**
 * Start local clock-based updates
 * Uses polling instead of setInterval for Decentraland compatibility
 */
function startLocalClockSync() {
  if (localClockActive) return
  localClockActive = true
  lastClockCheck = Date.now()
  
  console.log('[Multiplayer] ⏰ Clock sync enabled')
  
  // Initialize with current round
  const info = getCurrentRoundInfo()
  currentRoundNumber = info.roundNumber
}

/**
 * Call this from a Decentraland system to update clock
 * Hybrid: Clock for round NUMBER, server for actual TIMER
 */
function checkClockUpdate() {
  if (!localClockActive) return
  
  const now = Date.now()
  if (now - lastClockCheck < 1000) return // Only check every second
  lastClockCheck = now
  
  const info = getCurrentRoundInfo()
  
  // Detect round change (from clock - ensures same tower)
  if (info.roundNumber !== currentRoundNumber) {
    currentRoundNumber = info.roundNumber
    console.log(`[Multiplayer] 🎮 Round #${info.roundNumber}`)
    
    if (onRoundChangedCallback) {
      onRoundChangedCallback(info)
    }
    if (onServerTowerReadyCallback) {
      onServerTowerReadyCallback(info.chunkIds)
    }
  }
  
  // Update timer - use SERVER time if connected, otherwise use clock
  if (onTimerUpdateCallback) {
    if (room && room.state) {
      // Connected to server - use server's timer (affected by speed multiplier)
      const serverTime = (room.state as any).remainingTime || info.remainingTime
      const multiplier = (room.state as any).speedMultiplier || 1
      onTimerUpdateCallback(serverTime, multiplier)
    } else {
      // Offline - use clock-based timer (no speed effect)
      onTimerUpdateCallback(info.remainingTime, 1)
    }
  }
}

function stopLocalClockSync() {
  localClockActive = false
}

// Export for use in engine system
export { checkClockUpdate }

// ============================================
// INITIALIZATION
// ============================================

export async function initMultiplayer(): Promise<boolean> {
  if (multiplayerInitialized) {
    return room !== null
  }
  
  multiplayerInitialized = true
  
  // Start local clock sync (works offline!)
  startLocalClockSync()
  
  const serverUrl = getServerUrl()
  
  console.log('[Multiplayer] ═══════════════════════════════════')
  console.log('[Multiplayer] 🔌 Connecting to Colyseus server...')
  console.log(`[Multiplayer] URL: ${serverUrl}`)
  console.log('[Multiplayer] ═══════════════════════════════════')
  
  try {
    console.log('[Multiplayer] Creating Colyseus client...')
    client = new Colyseus.Client(serverUrl)
    
    console.log('[Multiplayer] Joining tower_room...')
    room = await client.joinOrCreate('tower_room', {
      displayName: 'Player',
    })
    
    console.log('[Multiplayer] ✅ Connected to server!')
    console.log(`[Multiplayer] Session: ${room.sessionId}`)
    console.log(`[Multiplayer] Room: ${room.roomId}`)
    
    setupStateListeners()
    return true
  } catch (error: any) {
    connectionFailed = true
    console.error('[Multiplayer] ❌ Connection failed!')
    console.error('[Multiplayer] Error:', error?.message || error)
    console.log('[Multiplayer] ⏰ Continuing with local clock sync (offline mode)')
    return false
  }
}

function setupStateListeners() {
  if (!room) return
  
  // State changes from server (for leaderboard, etc.)
  room.onStateChange((state: any) => {
    // Leaderboard updates
    if (onLeaderboardUpdateCallback && state.players) {
      const players: LeaderboardEntry[] = []
      state.players.forEach((player: any) => {
        players.push({
          address: player.address || '',
          displayName: player.displayName || '',
          maxHeight: player.maxHeight || 0,
          bestTime: player.bestTime || 0,
          isFinished: player.isFinished || false,
          finishOrder: player.finishOrder || 0
        })
      })
      
      players.sort((a, b) => {
        if (a.isFinished && b.isFinished) return a.finishOrder - b.finishOrder
        if (a.isFinished) return -1
        if (b.isFinished) return 1
        return b.maxHeight - a.maxHeight
      })
      
      onLeaderboardUpdateCallback(players)
    }
  })
  
  // Round ended
  room.onMessage('roundEnded', (data: { winners: WinnerEntry[] }) => {
    console.log('[Multiplayer] 🏁 Round ended!')
    if (onGameEndedCallback) {
      onGameEndedCallback(data.winners)
    }
  })
  
  // Player finished
  room.onMessage('playerFinished', (data: any) => {
    console.log(`[Multiplayer] 🏆 ${data.displayName} finished! (x${data.speedMultiplier})`)
  })
  
  // Connection handlers
  room.onError((code: number, message?: string) => {
    console.error(`[Multiplayer] ❌ Error (${code}): ${message}`)
  })
  
  room.onLeave((code: number) => {
    console.log(`[Multiplayer] 👋 Left room (${code})`)
    room = null
  })
}

// ============================================
// PUBLIC API - Callbacks
// ============================================

export function setOnServerTowerReady(callback: ((chunks: string[]) => void) | null) {
  onServerTowerReadyCallback = callback
  
  // Immediately call with current round's tower
  if (callback) {
    const info = getCurrentRoundInfo()
    callback(info.chunkIds)
  }
}

export function setOnTimerUpdate(callback: ((remaining: number, multiplier: number) => void) | null) {
  onTimerUpdateCallback = callback
}

export function setOnLeaderboardUpdate(callback: ((players: LeaderboardEntry[]) => void) | null) {
  onLeaderboardUpdateCallback = callback
}

export function setOnGameEnded(callback: ((winners: WinnerEntry[]) => void) | null) {
  onGameEndedCallback = callback
}

export function setOnRoundChanged(callback: ((roundInfo: RoundInfo) => void) | null) {
  onRoundChangedCallback = callback
}

// ============================================
// PUBLIC API - State
// ============================================

export function isServer(): boolean {
  return false
}

export function isMultiplayerAvailable(): boolean {
  return room !== null || localClockActive
}

export function isConnectedToServer(): boolean {
  return room !== null
}

export function setupServer() {
  console.log('[Multiplayer] Server is separate process')
}

export function setupClient() {
  console.log('[Multiplayer] Client ready (clock-based sync)')
}

// ============================================
// PUBLIC API - Send to Server
// ============================================

export function sendHeightUpdate(height: number) {
  room?.send('playerHeight', { height })
}

export function sendPlayerFinished(time: number, height: number) {
  if (room) {
    console.log(`[Multiplayer] 📤 Sending FINISH to server: ${time.toFixed(2)}s`)
    room.send('playerFinished', { time, height })
  } else {
    console.log('[Multiplayer] ⚠️ Not connected - finish not sent to server')
  }
}

export function sendPlayerDied(height: number) {
  console.log(`[Multiplayer] 📤 Died at ${height.toFixed(1)}m`)
  room?.send('playerDied', { height })
}

export function sendPlayerJoined(displayName: string, address?: string) {
  console.log(`[Multiplayer] 📤 Joined as ${displayName}`)
  room?.send('playerJoined', { displayName, address })
}

// ============================================
// UTILITIES
// ============================================

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function disconnect() {
  stopLocalClockSync()
  room?.leave()
  room = null
  console.log('[Multiplayer] Disconnected')
}

export function getSessionId(): string | null {
  return room?.sessionId || null
}

/**
 * Get current round info (can be called anytime!)
 */
export function getRoundInfo(): RoundInfo {
  return getCurrentRoundInfo()
}
