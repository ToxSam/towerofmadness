/**
 * Tower of Madness - Multiplayer System (Clock-Based Sync)
 * 
 * Uses REAL-WORLD TIME for round synchronization:
 * - Rounds are 7 minutes, synced to UTC clock
 * - All players worldwide are in the same round
 * - Tower generated deterministically from round number
 * - Works even without server connection (fallback)
 */

// Colyseus import - may fail in some environments
let Colyseus: any = null
try {
  // @ts-ignore
  Colyseus = require('colyseus.js')
} catch (e) {
  console.log('[Multiplayer] Colyseus.js not available')
}

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
 * (called by initMultiplayer setup)
 */
function checkClockUpdate() {
  if (!localClockActive) return
  
  const now = Date.now()
  if (now - lastClockCheck < 1000) return // Only check every second
  lastClockCheck = now
  
  const info = getCurrentRoundInfo()
  
  // Detect round change
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
  
  // Update timer
  if (onTimerUpdateCallback) {
    const multiplier = room ? (room.state as any)?.speedMultiplier || 1 : 1
    onTimerUpdateCallback(info.remainingTime, multiplier)
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
  
  // Check if Colyseus is available
  if (!Colyseus) {
    console.log('[Multiplayer] ⚠️ Colyseus not loaded - offline mode')
    return false
  }
  
  const serverUrl = getServerUrl()
  
  console.log('[Multiplayer] ═══════════════════════════════════')
  console.log('[Multiplayer] 🔌 Connecting to server...')
  console.log(`[Multiplayer] URL: ${serverUrl}`)
  console.log('[Multiplayer] ═══════════════════════════════════')
  
  try {
    client = new Colyseus.Client(serverUrl)
    room = await client.joinOrCreate('tower_room', {
      displayName: 'Player',
    })
    
    console.log('[Multiplayer] ✅ Connected!')
    console.log(`[Multiplayer] Session: ${room.sessionId}`)
    console.log(`[Multiplayer] Room: ${room.roomId}`)
    
    setupStateListeners()
    return true
  } catch (error) {
    connectionFailed = true
    console.error('[Multiplayer] ❌ Connection failed:', error)
    console.log('[Multiplayer] ⏰ Using local clock sync (offline mode)')
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
  console.log(`[Multiplayer] 📤 Finished: ${time.toFixed(2)}s`)
  room?.send('playerFinished', { time, height })
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
