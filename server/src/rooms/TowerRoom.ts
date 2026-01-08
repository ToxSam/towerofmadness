/**
 * Tower of Madness - TowerRoom
 * 
 * Main game room that handles:
 * - Tower generation (same chunks for all players)
 * - 7-minute round timer with speed multiplier
 * - Player tracking (height, finish time)
 * - Leaderboard and winners
 * - Round lifecycle (active -> ending -> break -> new round)
 */

import { Room, Client } from 'colyseus'
import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema'

// ============================================
// CONSTANTS
// ============================================

const CHUNK_OPTIONS = ['Chunk01', 'Chunk02', 'Chunk03']
const MIN_CHUNKS = 3
const MAX_CHUNKS = 8
const BASE_TIMER = 420 // 7 minutes in seconds
const ROUND_END_DISPLAY_TIME = 3000 // 3 seconds to show winners
const NEW_ROUND_DELAY = 10000 // 10 seconds break
const TIMER_UPDATE_INTERVAL = 1000 // Update every second
const MAX_PLAYERS = 50

// ============================================
// STATE SCHEMAS
// ============================================

/**
 * Player state tracked by the server
 */
export class PlayerState extends Schema {
  @type('string') sessionId: string = ''
  @type('string') address: string = ''
  @type('string') displayName: string = ''
  @type('number') maxHeight: number = 0
  @type('number') bestTime: number = 0 // 0 = not finished
  @type('boolean') isFinished: boolean = false
  @type('number') finishOrder: number = 0 // 0 = not finished, 1 = first, 2 = second, etc.
  @type('number') lastUpdate: number = 0
}

/**
 * Winner entry for round results
 */
export class WinnerState extends Schema {
  @type('string') address: string = ''
  @type('string') displayName: string = ''
  @type('number') time: number = 0
  @type('number') height: number = 0
  @type('number') rank: number = 0
}

/**
 * Main game room state
 */
export class TowerRoomState extends Schema {
  // Round identification
  @type('string') roundId: string = ''
  
  // Tower chunks (Chunk01, Chunk02, etc.)
  @type(['string']) chunkIds = new ArraySchema<string>()
  
  // Timer state
  @type('number') roundStartTime: number = 0
  @type('number') remainingTime: number = BASE_TIMER
  @type('number') speedMultiplier: number = 1
  
  // Round state
  @type('string') roundState: string = 'ACTIVE' // ACTIVE, ENDING, BREAK
  @type('boolean') gameEnded: boolean = false
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
  // Keep room alive even when empty!
  autoDispose = false
  
  // Internal state
  private timerInterval: NodeJS.Timeout | null = null
  private newRoundTimeout: NodeJS.Timeout | null = null
  
  // ============================================
  // LIFECYCLE
  // ============================================
  
  onCreate(options: any) {
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log('[TowerRoom] 🎮 Room created!')
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    // Set max clients
    this.maxClients = MAX_PLAYERS
    
    // Initialize state
    this.setState(new TowerRoomState())
    
    // Start first round
    this.startNewRound()
    
    // Start timer update loop
    this.timerInterval = setInterval(() => this.updateTimer(), TIMER_UPDATE_INTERVAL)
    
    // Register message handlers
    this.onMessage('playerHeight', (client, data) => this.handlePlayerHeight(client, data))
    this.onMessage('playerFinished', (client, data) => this.handlePlayerFinished(client, data))
    this.onMessage('playerDied', (client, data) => this.handlePlayerDied(client, data))
    this.onMessage('playerJoined', (client, data) => this.handlePlayerJoined(client, data))
    
    console.log('[TowerRoom] Room initialized and waiting for players')
  }
  
  onJoin(client: Client, options: any) {
    console.log(`[TowerRoom] 👤 Player joined: ${client.sessionId}`)
    
    // Create player state
    const player = new PlayerState()
    player.sessionId = client.sessionId
    player.address = options?.address || client.sessionId
    player.displayName = options?.displayName || `Player_${client.sessionId.substring(0, 4)}`
    player.maxHeight = 0
    player.bestTime = 0
    player.isFinished = false
    player.finishOrder = 0
    player.lastUpdate = Date.now()
    
    // Add to players map
    this.state.players.set(client.sessionId, player)
    
    console.log(`[TowerRoom] Players in room: ${this.state.players.size}`)
    
    // Send current tower state to new player
    // (Colyseus auto-syncs state, but we log it for clarity)
    console.log(`[TowerRoom] Sending tower to ${client.sessionId}: [${Array.from(this.state.chunkIds).join(', ')}]`)
  }
  
  onLeave(client: Client, consented: boolean) {
    console.log(`[TowerRoom] 👋 Player left: ${client.sessionId} (consented: ${consented})`)
    
    // Remove player from tracking
    this.state.players.delete(client.sessionId)
    
    console.log(`[TowerRoom] Players remaining: ${this.state.players.size}`)
  }
  
  onDispose() {
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log('[TowerRoom] 🔌 Room disposed')
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    // Clear intervals
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
    if (this.newRoundTimeout) {
      clearTimeout(this.newRoundTimeout)
      this.newRoundTimeout = null
    }
  }
  
  // ============================================
  // ROUND MANAGEMENT
  // ============================================
  
  /**
   * Start a new round with random tower
   */
  private startNewRound() {
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log('[TowerRoom] 🎮 STARTING NEW ROUND')
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    // Generate round ID
    this.state.roundId = `round_${Date.now()}`
    
    // Generate random tower chunks
    const numChunks = Math.floor(Math.random() * (MAX_CHUNKS - MIN_CHUNKS + 1)) + MIN_CHUNKS
    this.state.chunkIds.clear()
    
    const selectedChunks: string[] = []
    for (let i = 0; i < numChunks; i++) {
      const randomChunk = CHUNK_OPTIONS[Math.floor(Math.random() * CHUNK_OPTIONS.length)]
      this.state.chunkIds.push(randomChunk)
      selectedChunks.push(randomChunk)
    }
    
    console.log(`[TowerRoom] Generated tower: [${selectedChunks.join(' → ')}] (${numChunks} chunks)`)
    
    // Reset timer state
    this.state.roundStartTime = Date.now()
    this.state.remainingTime = BASE_TIMER
    this.state.speedMultiplier = 1
    this.state.finisherCount = 0
    
    // Reset round state
    this.state.roundState = 'ACTIVE'
    this.state.gameEnded = false
    this.state.winners.clear()
    
    // Reset all player states
    this.state.players.forEach((player) => {
      player.maxHeight = 0
      player.bestTime = 0
      player.isFinished = false
      player.finishOrder = 0
    })
    
    console.log('[TowerRoom] Round started! Timer: 7:00 (x1)')
    
    // Broadcast new round to all clients (state sync handles this)
    this.broadcast('newRound', {
      roundId: this.state.roundId,
      chunkIds: Array.from(this.state.chunkIds)
    })
  }
  
  /**
   * Update the round timer (called every second)
   */
  private updateTimer() {
    // Handle ENDING state (show winners for 3 seconds)
    if (this.state.roundState === 'ENDING') {
      // Just wait - the endRound function schedules the transition to BREAK
      return
    }
    
    // Handle BREAK state (waiting for new round)
    if (this.state.roundState === 'BREAK') {
      // Just wait - newRound will be triggered by timeout
      return
    }
    
    // ACTIVE state - count down timer
    if (this.state.roundState === 'ACTIVE') {
      const elapsed = (Date.now() - this.state.roundStartTime) / 1000
      const adjustedElapsed = elapsed * this.state.speedMultiplier
      this.state.remainingTime = Math.max(0, BASE_TIMER - adjustedElapsed)
      
      // Log every 30 seconds
      if (Math.floor(this.state.remainingTime) % 30 === 0 && Math.floor(this.state.remainingTime) !== BASE_TIMER) {
        const mins = Math.floor(this.state.remainingTime / 60)
        const secs = Math.floor(this.state.remainingTime % 60)
        console.log(`[TowerRoom] Timer: ${mins}:${secs.toString().padStart(2, '0')} (x${this.state.speedMultiplier})`)
      }
      
      // Check if round ended
      if (this.state.remainingTime <= 0) {
        this.endRound()
      }
    }
  }
  
  /**
   * End the current round and show results
   */
  private endRound() {
    console.log('[TowerRoom] ═══════════════════════════════════')
    console.log('[TowerRoom] 🏁 ROUND ENDED!')
    console.log('[TowerRoom] ═══════════════════════════════════')
    
    this.state.roundState = 'ENDING'
    this.state.gameEnded = true
    
    // Calculate winners (top 3 by finish time, or by height if not finished)
    const playerArray = Array.from(this.state.players.values())
    
    // Sort: finished players first (by time), then by height
    playerArray.sort((a, b) => {
      // Both finished - sort by time (lower is better)
      if (a.isFinished && b.isFinished) {
        return a.bestTime - b.bestTime
      }
      // Only a finished
      if (a.isFinished && !b.isFinished) return -1
      // Only b finished
      if (!a.isFinished && b.isFinished) return 1
      // Neither finished - sort by height (higher is better)
      return b.maxHeight - a.maxHeight
    })
    
    // Get top 3
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
    
    // Broadcast round ended message
    this.broadcast('roundEnded', {
      winners: top3.map((p, i) => ({
        address: p.address,
        displayName: p.displayName,
        time: p.bestTime,
        height: p.maxHeight,
        rank: i + 1
      }))
    })
    
    // Schedule transition to break state
    setTimeout(() => {
      this.state.roundState = 'BREAK'
      console.log('[TowerRoom] ⏳ Break time! New round in 10 seconds...')
      
      // Schedule new round
      this.newRoundTimeout = setTimeout(() => {
        this.startNewRound()
      }, NEW_ROUND_DELAY)
    }, ROUND_END_DISPLAY_TIME)
  }
  
  // ============================================
  // MESSAGE HANDLERS
  // ============================================
  
  /**
   * Handle player height update
   */
  private handlePlayerHeight(client: Client, data: { height: number }) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    
    // Only update if higher than current max
    if (data.height > player.maxHeight) {
      player.maxHeight = data.height
      player.lastUpdate = Date.now()
    }
  }
  
  /**
   * Handle player finished (reached TriggerEnd)
   */
  private handlePlayerFinished(client: Client, data: { time: number; height: number }) {
    const player = this.state.players.get(client.sessionId)
    if (!player || player.isFinished) return
    
    console.log(`[TowerRoom] 🏆 Player finished: ${player.displayName} in ${data.time.toFixed(2)}s`)
    
    // Mark as finished
    player.isFinished = true
    player.bestTime = data.time
    player.maxHeight = data.height
    player.finishOrder = ++this.state.finisherCount
    
    // Increase speed multiplier
    this.state.speedMultiplier = this.state.finisherCount + 1
    
    console.log(`[TowerRoom] ⚡ Timer speed now: x${this.state.speedMultiplier}`)
    
    // Broadcast player finished
    this.broadcast('playerFinished', {
      sessionId: client.sessionId,
      displayName: player.displayName,
      time: data.time,
      finishOrder: player.finishOrder,
      speedMultiplier: this.state.speedMultiplier
    })
  }
  
  /**
   * Handle player died (entered TriggerDeath)
   */
  private handlePlayerDied(client: Client, data: { height: number }) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    
    console.log(`[TowerRoom] ☠️ Player died: ${player.displayName} at ${data.height.toFixed(1)}m`)
    
    // Update max height if this was higher
    if (data.height > player.maxHeight) {
      player.maxHeight = data.height
    }
    
    // Note: Player can retry (enter TriggerStart again), so we don't mark them as "finished"
  }
  
  /**
   * Handle player joined with display name
   */
  private handlePlayerJoined(client: Client, data: { displayName: string; address?: string }) {
    const player = this.state.players.get(client.sessionId)
    if (!player) return
    
    player.displayName = data.displayName || player.displayName
    if (data.address) {
      player.address = data.address
    }
    
    console.log(`[TowerRoom] 📝 Player info updated: ${player.displayName}`)
  }
}
