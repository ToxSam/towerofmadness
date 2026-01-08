/**
 * Tower of Madness - TowerRoom (Clock-Based Sync)
 * 
 * Uses REAL-WORLD TIME to synchronize rounds:
 * - Rounds start every 7 minutes based on UTC time
 * - Round 0 started at Unix epoch (Jan 1, 1970)
 * - All clients calculate the same round from their local clock
 * - Tower is generated deterministically from round number
 * 
 * This ensures:
 * - All players see the same tower
 * - Timer is always in sync
 * - Works even if server restarts
 */

import { Room, Client } from 'colyseus'
import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema'

// ============================================
// CONSTANTS
// ============================================

const CHUNK_OPTIONS = ['Chunk01', 'Chunk02', 'Chunk03']
const MIN_CHUNKS = 3
const MAX_CHUNKS = 8
const ROUND_DURATION = 420 // 7 minutes in seconds
const BREAK_DURATION = 10 // 10 seconds break between rounds
const TOTAL_CYCLE = ROUND_DURATION + BREAK_DURATION // 430 seconds per cycle
const TIMER_UPDATE_INTERVAL = 1000 // Update every second
const MAX_PLAYERS = 50

// ============================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================

/**
 * Simple seeded random number generator
 * Same seed = same sequence of random numbers
 */
class SeededRandom {
  private seed: number
  
  constructor(seed: number) {
    this.seed = seed
  }
  
  // Returns a number between 0 and 1
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }
  
  // Returns an integer between min and max (inclusive)
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }
}

// ============================================
// CLOCK-BASED ROUND CALCULATOR
// ============================================

interface RoundInfo {
  roundNumber: number
  isBreak: boolean
  remainingTime: number
  cycleProgress: number
}

function getCurrentRoundInfo(): RoundInfo {
  const now = Math.floor(Date.now() / 1000) // Current time in seconds
  const cycleNumber = Math.floor(now / TOTAL_CYCLE)
  const cycleProgress = now % TOTAL_CYCLE
  
  const isBreak = cycleProgress >= ROUND_DURATION
  const remainingTime = isBreak 
    ? TOTAL_CYCLE - cycleProgress // Time until next round
    : ROUND_DURATION - cycleProgress // Time until round ends
  
  return {
    roundNumber: cycleNumber,
    isBreak,
    remainingTime,
    cycleProgress
  }
}

/**
 * Generate tower chunks deterministically from round number
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
// STATE SCHEMAS
// ============================================

export class PlayerState extends Schema {
  @type('string') sessionId: string = ''
  @type('string') address: string = ''
  @type('string') displayName: string = ''
  @type('number') maxHeight: number = 0
  @type('number') bestTime: number = 0
  @type('boolean') isFinished: boolean = false
  @type('number') finishOrder: number = 0
  @type('number') lastUpdate: number = 0
}

export class WinnerState extends Schema {
  @type('string') address: string = ''
  @type('string') displayName: string = ''
  @type('number') time: number = 0
  @type('number') height: number = 0
  @type('number') rank: number = 0
}

export class TowerRoomState extends Schema {
  // Round identification (based on clock)
  @type('number') roundNumber: number = 0
  
  // Tower chunks (deterministic from round number)
  @type(['string']) chunkIds = new ArraySchema<string>()
  
  // Timer state (calculated from clock)
  @type('number') serverTime: number = 0 // Server's current time (for sync)
  @type('number') remainingTime: number = ROUND_DURATION
  @type('number') speedMultiplier: number = 1
  
  // Round state
  @type('string') roundState: string = 'ACTIVE' // ACTIVE, BREAK
  @type('number') finisherCount: number = 0
  
  // Player tracking
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
  
  // Winners (top 3)
  @type([WinnerState]) winners = new ArraySchema<WinnerState>()
}

// ============================================
// TOWER ROOM
// ============================================

export class TowerRoom extends Room<TowerRoomState> {
  private timerInterval: NodeJS.Timeout | null = null
  private currentRoundNumber: number = -1
  
  onCreate(options: any) {
    // Keep room alive even when empty
    this.autoDispose = false
    
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log('[TowerRoom] 🎮 Room created! (Clock-Based Sync)')
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    this.maxClients = MAX_PLAYERS
    this.setState(new TowerRoomState())
    
    // Initialize with current round
    this.syncWithClock()
    
    // Update every second
    this.timerInterval = setInterval(() => this.syncWithClock(), TIMER_UPDATE_INTERVAL)
    
    // Register message handlers
    this.onMessage('playerHeight', (client, data) => this.handlePlayerHeight(client, data))
    this.onMessage('playerFinished', (client, data) => this.handlePlayerFinished(client, data))
    this.onMessage('playerDied', (client, data) => this.handlePlayerDied(client, data))
    this.onMessage('playerJoined', (client, data) => this.handlePlayerJoined(client, data))
    
    console.log('[TowerRoom] ⏰ Using UTC clock for round synchronization')
    console.log(`[TowerRoom] Round duration: ${ROUND_DURATION}s (${ROUND_DURATION/60} min)`)
    console.log(`[TowerRoom] Break duration: ${BREAK_DURATION}s`)
  }
  
  /**
   * Sync room state with real-world clock
   */
  private syncWithClock() {
    const info = getCurrentRoundInfo()
    
    // Update server time for client sync
    this.state.serverTime = Date.now()
    this.state.remainingTime = info.remainingTime
    
    // Check if round changed
    if (info.roundNumber !== this.currentRoundNumber) {
      this.currentRoundNumber = info.roundNumber
      this.startNewRound(info.roundNumber)
    }
    
    // Update round state
    if (info.isBreak && this.state.roundState !== 'BREAK') {
      this.endRound()
    } else if (!info.isBreak && this.state.roundState === 'BREAK') {
      // Round already started via roundNumber change
    }
    
    // Apply speed multiplier to displayed time (visual only)
    // The actual round end is still based on clock
    const displayTime = Math.max(0, info.remainingTime / this.state.speedMultiplier)
    this.state.remainingTime = Math.floor(displayTime)
    
    // Log every 30 seconds during active round
    if (!info.isBreak && info.remainingTime % 30 === 0 && info.remainingTime > 0 && info.remainingTime < ROUND_DURATION) {
      const mins = Math.floor(info.remainingTime / 60)
      const secs = info.remainingTime % 60
      console.log(`[TowerRoom] ⏱️ ${mins}:${secs.toString().padStart(2, '0')} remaining (x${this.state.speedMultiplier})`)
    }
  }
  
  /**
   * Start a new round with deterministic tower
   */
  private startNewRound(roundNumber: number) {
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log(`[TowerRoom] 🎮 ROUND #${roundNumber} STARTING!`)
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    this.state.roundNumber = roundNumber
    this.state.roundState = 'ACTIVE'
    this.state.speedMultiplier = 1
    this.state.finisherCount = 0
    this.state.winners.clear()
    
    // Generate tower deterministically from round number
    const chunks = generateTowerForRound(roundNumber)
    this.state.chunkIds.clear()
    chunks.forEach(chunk => this.state.chunkIds.push(chunk))
    
    console.log(`[TowerRoom] 🗼 Tower: [${chunks.join(' → ')}] (${chunks.length} chunks)`)
    console.log(`[TowerRoom] 🌍 All players worldwide see this same tower!`)
    
    // Reset all player states
    this.state.players.forEach((player) => {
      player.maxHeight = 0
      player.bestTime = 0
      player.isFinished = false
      player.finishOrder = 0
    })
    
    // Broadcast new round
    this.broadcast('newRound', {
      roundNumber,
      chunkIds: chunks
    })
  }
  
  /**
   * End the current round
   */
  private endRound() {
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log('[TowerRoom] 🏁 ROUND ENDED!')
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    this.state.roundState = 'BREAK'
    
    // Calculate winners
    const playerArray = Array.from(this.state.players.values())
    playerArray.sort((a, b) => {
      if (a.isFinished && b.isFinished) return a.bestTime - b.bestTime
      if (a.isFinished) return -1
      if (b.isFinished) return 1
      return b.maxHeight - a.maxHeight
    })
    
    this.state.winners.clear()
    const top3 = playerArray.slice(0, 3)
    
    top3.forEach((player, index) => {
      const winner = new WinnerState()
      winner.address = player.address
      winner.displayName = player.displayName
      winner.time = player.bestTime
      winner.height = player.maxHeight
      winner.rank = index + 1
      this.state.winners.push(winner)
      
      console.log(`[TowerRoom] ${index + 1}. ${player.displayName}: ${player.isFinished ? `${player.bestTime.toFixed(2)}s` : `${player.maxHeight.toFixed(1)}m (DNF)`}`)
    })
    
    this.broadcast('roundEnded', {
      winners: top3.map((p, i) => ({
        address: p.address,
        displayName: p.displayName,
        time: p.bestTime,
        height: p.maxHeight,
        rank: i + 1
      }))
    })
    
    console.log(`[TowerRoom] ⏳ Next round in ${BREAK_DURATION} seconds...`)
  }
  
  // ============================================
  // PLAYER LIFECYCLE
  // ============================================
  
  onJoin(client: Client, options: any) {
    console.log(`[TowerRoom] 👤 Player joined: ${client.sessionId}`)
    
    const player = new PlayerState()
    player.sessionId = client.sessionId
    player.address = options?.address || client.sessionId
    player.displayName = options?.displayName || `Player_${client.sessionId.substring(0, 4)}`
    player.maxHeight = 0
    player.bestTime = 0
    player.isFinished = false
    player.finishOrder = 0
    player.lastUpdate = Date.now()
    
    this.state.players.set(client.sessionId, player)
    
    // Send current round info to new player
    const info = getCurrentRoundInfo()
    console.log(`[TowerRoom] 📤 Sending round #${info.roundNumber} to ${client.sessionId}`)
    console.log(`[TowerRoom] Players in room: ${this.state.players.size}`)
  }
  
  onLeave(client: Client, consented: boolean) {
    console.log(`[TowerRoom] 👋 Player left: ${client.sessionId}`)
    this.state.players.delete(client.sessionId)
    console.log(`[TowerRoom] Players remaining: ${this.state.players.size}`)
  }
  
  onDispose() {
    console.log('[TowerRoom] 🔌 Room disposed')
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
    }
  }
  
  // ============================================
  // MESSAGE HANDLERS
  // ============================================
  
  private handlePlayerHeight(client: Client, data: { height: number }) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    
    if (data.height > player.maxHeight) {
      player.maxHeight = data.height
      player.lastUpdate = Date.now()
    }
  }
  
  private handlePlayerFinished(client: Client, data: { time: number; height: number }) {
    const player = this.state.players.get(client.sessionId)
    if (!player || player.isFinished) return
    
    console.log(`[TowerRoom] 🏆 ${player.displayName} finished in ${data.time.toFixed(2)}s`)
    
    player.isFinished = true
    player.bestTime = data.time
    player.maxHeight = data.height
    player.finishOrder = ++this.state.finisherCount
    
    // Speed up displayed timer (visual feedback)
    this.state.speedMultiplier = Math.min(this.state.finisherCount + 1, 5) // Cap at 5x
    console.log(`[TowerRoom] ⚡ Visual timer speed: x${this.state.speedMultiplier}`)
    
    this.broadcast('playerFinished', {
      sessionId: client.sessionId,
      displayName: player.displayName,
      time: data.time,
      finishOrder: player.finishOrder,
      speedMultiplier: this.state.speedMultiplier
    })
  }
  
  private handlePlayerDied(client: Client, data: { height: number }) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    
    console.log(`[TowerRoom] ☠️ ${player.displayName} died at ${data.height.toFixed(1)}m`)
    
    if (data.height > player.maxHeight) {
      player.maxHeight = data.height
    }
  }
  
  private handlePlayerJoined(client: Client, data: { displayName: string; address?: string }) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    
    player.displayName = data.displayName || player.displayName
    if (data.address) player.address = data.address
    
    console.log(`[TowerRoom] 📝 Player info: ${player.displayName}`)
  }
}
