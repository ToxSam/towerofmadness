/**
 * Tower of Madness - Multiplayer System
 * 
 * Handles authoritative server communication for synchronized gameplay.
 * Server controls: tower generation, round timer, leaderboard, winners
 * Clients: send player updates, receive game state
 */

import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer as checkIsServer, registerMessages } from '@dcl/sdk/network'

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

// ============================================
// MESSAGE SCHEMAS
// ============================================

const Messages = {
  // Server → Clients
  gameStarted: Schemas.Map({
    roundId: Schemas.String,
    chunkIds: Schemas.Array(Schemas.String),
    startTime: Schemas.Int64
  }),
  
  timerUpdate: Schemas.Map({
    remainingTime: Schemas.Float,
    speedMultiplier: Schemas.Float
  }),
  
  leaderboardUpdate: Schemas.Map({
    players: Schemas.Array(Schemas.Map({
      address: Schemas.String,
      displayName: Schemas.String,
      maxHeight: Schemas.Float,
      bestTime: Schemas.Float,
      isFinished: Schemas.Boolean,
      finishOrder: Schemas.Int
    }))
  }),
  
  gameEnded: Schemas.Map({
    roundId: Schemas.String,
    winners: Schemas.Array(Schemas.Map({
      address: Schemas.String,
      displayName: Schemas.String,
      time: Schemas.Float,
      height: Schemas.Float,
      rank: Schemas.Int
    }))
  }),
  
  // Clients → Server
  playerHeightUpdate: Schemas.Map({
    height: Schemas.Float
  }),
  
  playerFinished: Schemas.Map({
    time: Schemas.Float,
    height: Schemas.Float
  }),
  
  playerDied: Schemas.Map({
    height: Schemas.Float
  }),
  
  playerJoined: Schemas.Map({
    displayName: Schemas.String
  })
}

// ============================================
// STATE
// ============================================

let room: ReturnType<typeof registerMessages<typeof Messages>> | null = null
let isServerInstance = false
let multiplayerInitialized = false

// Callbacks
let _onServerTowerReady: ((chunks: string[]) => void) | null = null
let _onTimerUpdate: ((remaining: number, multiplier: number) => void) | null = null
let _onLeaderboardUpdate: ((players: LeaderboardEntry[]) => void) | null = null
let _onGameEnded: ((winners: WinnerEntry[]) => void) | null = null

// ============================================
// INITIALIZATION
// ============================================

export async function initMultiplayer(): Promise<boolean> {
  if (multiplayerInitialized) {
    return room !== null
  }
  
  try {
    // Register messages and get room
    room = registerMessages(Messages)
    isServerInstance = checkIsServer()
    multiplayerInitialized = true
    
    console.log('[Multiplayer] ✅ Initialized!')
    console.log('[Multiplayer] Is Server:', isServerInstance)
    return true
  } catch (error) {
    console.log('[Multiplayer] ⚠️ SDK network module not available')
    console.log('[Multiplayer] Running in SINGLE-PLAYER mode')
    multiplayerInitialized = true
    return false
  }
}

export function isServer(): boolean {
  return isServerInstance
}

export function isMultiplayerAvailable(): boolean {
  return room !== null
}

// ============================================
// CALLBACK SETTERS
// ============================================

export function setOnServerTowerReady(callback: ((chunks: string[]) => void) | null) {
  _onServerTowerReady = callback
}

export function setOnTimerUpdate(callback: ((remaining: number, multiplier: number) => void) | null) {
  _onTimerUpdate = callback
}

export function setOnLeaderboardUpdate(callback: ((players: LeaderboardEntry[]) => void) | null) {
  _onLeaderboardUpdate = callback
}

export function setOnGameEnded(callback: ((winners: WinnerEntry[]) => void) | null) {
  _onGameEnded = callback
}

// ============================================
// SERVER LOGIC
// ============================================

type PlayerData = {
  address: string
  displayName: string
  maxHeight: number
  bestTime: number | null
  isFinished: boolean
  finishOrder: number | null
}

const CHUNK_OPTIONS = ['Chunk01', 'Chunk02', 'Chunk03']
const BASE_TIMER = 420 // 7 minutes
const MIN_CHUNKS = 3
const MAX_CHUNKS = 8
const ROUND_BREAK = 10 // seconds

let currentRound = {
  id: '',
  chunkIds: [] as string[],
  startTime: 0,
  speedMultiplier: 1.0,
  finishCount: 0,
  players: new Map<string, PlayerData>()
}

// Server timer state
let serverTimerLastTick = 0
let serverTimerAccumulator = 0
const SERVER_TICK_INTERVAL = 1.0 // Tick every 1 second

// Delay system for round break
let roundBreakDelay = 0
let isWaitingForRoundBreak = false

export function setupServer() {
  if (!room) {
    console.error('[SERVER] Room not initialized!')
    return
  }
  
  console.log('[SERVER] ═══════════════════════════════════')
  console.log('[SERVER] 🎮 Tower of Madness Server Starting')
  console.log('[SERVER] ═══════════════════════════════════')
  
  // Handle player height updates
  room.onMessage('playerHeightUpdate', (data: { height: number }, ctx) => {
    const addr = ctx?.from || 'unknown'
    
    if (!currentRound.players.has(addr)) {
      currentRound.players.set(addr, {
        address: addr,
        displayName: `Player ${currentRound.players.size + 1}`,
        maxHeight: data.height,
        bestTime: null,
        isFinished: false,
        finishOrder: null
      })
    } else {
      const p = currentRound.players.get(addr)!
      if (data.height > p.maxHeight) {
        p.maxHeight = data.height
      }
    }
    
    broadcastLeaderboard()
  })
  
  // Handle player finish
  room.onMessage('playerFinished', (data: { time: number; height: number }, ctx) => {
    const addr = ctx?.from || 'unknown'
    const p = currentRound.players.get(addr)
    
    if (p && !p.isFinished) {
      currentRound.finishCount++
      p.isFinished = true
      p.bestTime = data.time
      p.finishOrder = currentRound.finishCount
      currentRound.speedMultiplier = currentRound.finishCount + 1
      
      console.log(`[SERVER] 🏆 ${addr} finished! #${currentRound.finishCount} | Timer now x${currentRound.speedMultiplier}`)
      broadcastLeaderboard()
    }
  })
  
  // Handle player death
  room.onMessage('playerDied', (data: { height: number }, ctx) => {
    console.log(`[SERVER] ☠️ ${ctx?.from} died at ${data.height.toFixed(1)}m`)
  })
  
  // Handle player join
  room.onMessage('playerJoined', (data: { displayName: string }, ctx) => {
    const addr = ctx?.from || 'unknown'
    
    if (!currentRound.players.has(addr)) {
      currentRound.players.set(addr, {
        address: addr,
        displayName: data.displayName || `Player ${currentRound.players.size + 1}`,
        maxHeight: 0,
        bestTime: null,
        isFinished: false,
        finishOrder: null
      })
      console.log(`[SERVER] 👋 ${data.displayName} joined!`)
    }
    
    // Send current game state
    if (currentRound.id) {
      room!.send('gameStarted', {
        roundId: currentRound.id,
        chunkIds: currentRound.chunkIds,
        startTime: currentRound.startTime
      })
    }
  })
  
  // Start first round
  startServerRound()
  
  // Add server timer system using engine.addSystem
  engine.addSystem(serverTimerSystem)
  
  console.log('[SERVER] ✅ Server ready!')
}

// Server timer system - runs every frame
function serverTimerSystem(dt: number) {
  // Handle round break delay
  if (isWaitingForRoundBreak) {
    roundBreakDelay -= dt
    if (roundBreakDelay <= 0) {
      isWaitingForRoundBreak = false
      startServerRound()
    }
    return
  }
  
  // Accumulate time and tick every SERVER_TICK_INTERVAL
  serverTimerAccumulator += dt
  if (serverTimerAccumulator >= SERVER_TICK_INTERVAL) {
    serverTimerAccumulator = 0
    serverTimerTick()
  }
}

function startServerRound() {
  const count = Math.floor(Math.random() * (MAX_CHUNKS - MIN_CHUNKS + 1)) + MIN_CHUNKS
  const chunks: string[] = []
  for (let i = 0; i < count; i++) {
    chunks.push(CHUNK_OPTIONS[Math.floor(Math.random() * CHUNK_OPTIONS.length)])
  }
  
  currentRound = {
    id: Date.now().toString(),
    chunkIds: chunks,
    startTime: Date.now(),
    speedMultiplier: 1.0,
    finishCount: 0,
    players: new Map()
  }
  
  console.log('[SERVER] ═══════════════════════════════════')
  console.log(`[SERVER] 🎮 NEW ROUND: ${chunks.join(' → ')}`)
  console.log('[SERVER] ═══════════════════════════════════')
  
  if (room) {
    room.send('gameStarted', {
      roundId: currentRound.id,
      chunkIds: chunks,
      startTime: currentRound.startTime
    })
  }
}

function serverTimerTick() {
  if (!currentRound.id) return
  
  const elapsed = (Date.now() - currentRound.startTime) / 1000
  const adjusted = elapsed * currentRound.speedMultiplier
  const remaining = Math.max(0, BASE_TIMER - adjusted)
  
  if (room) {
    room.send('timerUpdate', {
      remainingTime: remaining,
      speedMultiplier: currentRound.speedMultiplier
    })
  }
  
  if (remaining <= 0) {
    endServerRound()
  }
}

function endServerRound() {
  console.log('[SERVER] 🏁 ROUND ENDED!')
  
  const sorted = Array.from(currentRound.players.values()).sort((a, b) => {
    if (a.isFinished && !b.isFinished) return -1
    if (!a.isFinished && b.isFinished) return 1
    if (a.isFinished && b.isFinished) return (a.finishOrder || 0) - (b.finishOrder || 0)
    return b.maxHeight - a.maxHeight
  })
  
  const winners: WinnerEntry[] = sorted.slice(0, 3).map((p, i) => ({
    address: p.address,
    displayName: p.displayName,
    time: p.bestTime || 0,
    height: p.maxHeight,
    rank: i + 1
  }))
  
  if (room) {
    room.send('gameEnded', {
      roundId: currentRound.id,
      winners
    })
  }
  
  // Schedule new round after break using delay system
  roundBreakDelay = ROUND_BREAK
  isWaitingForRoundBreak = true
}

function broadcastLeaderboard() {
  if (!room) return
  
  const arr: LeaderboardEntry[] = Array.from(currentRound.players.values()).map(p => ({
    address: p.address,
    displayName: p.displayName,
    maxHeight: p.maxHeight,
    bestTime: p.bestTime || 0,
    isFinished: p.isFinished,
    finishOrder: p.finishOrder || 0
  }))
  
  arr.sort((a, b) => b.maxHeight - a.maxHeight)
  
  room.send('leaderboardUpdate', { players: arr })
}

// ============================================
// CLIENT LOGIC
// ============================================

export function setupClient() {
  if (!room) {
    console.error('[CLIENT] Room not initialized!')
    return
  }
  
  console.log('[CLIENT] Connecting to server...')
  
  room.onMessage('gameStarted', (data: { roundId: string; chunkIds: string[]; startTime: number }) => {
    console.log('[CLIENT] 🎮 New round:', data.chunkIds.join(' → '))
    if (_onServerTowerReady) {
      _onServerTowerReady(data.chunkIds)
    }
  })
  
  room.onMessage('timerUpdate', (data: { remainingTime: number; speedMultiplier: number }) => {
    if (_onTimerUpdate) {
      _onTimerUpdate(data.remainingTime, data.speedMultiplier)
    }
  })
  
  room.onMessage('leaderboardUpdate', (data: { players: LeaderboardEntry[] }) => {
    if (_onLeaderboardUpdate) {
      _onLeaderboardUpdate(data.players)
    }
  })
  
  room.onMessage('gameEnded', (data: { roundId: string; winners: WinnerEntry[] }) => {
    console.log('[CLIENT] 🏁 Round ended!')
    if (_onGameEnded) {
      _onGameEnded(data.winners)
    }
  })
  
  console.log('[CLIENT] ✅ Connected!')
}

// ============================================
// CLIENT API
// ============================================

export function sendHeightUpdate(height: number) {
  if (room) {
    room.send('playerHeightUpdate', { height })
  }
}

export function sendPlayerFinished(time: number, height: number) {
  if (room) {
    room.send('playerFinished', { time, height })
    console.log(`[CLIENT] 🏆 Finished! Time: ${time.toFixed(2)}s`)
  }
}

export function sendPlayerDied(height: number) {
  if (room) {
    room.send('playerDied', { height })
  }
}

export function sendPlayerJoined(displayName: string) {
  if (room) {
    room.send('playerJoined', { displayName })
  }
}

// ============================================
// UTILITIES
// ============================================

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
