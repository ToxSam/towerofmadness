/**
 * Tower of Madness - Colyseus Server (Clock-Based Sync)
 * 
 * Uses real-world UTC time for round synchronization:
 * - Rounds are 7 minutes long
 * - 10 second break between rounds
 * - All players worldwide are in the same round
 * - Tower is generated deterministically from round number
 */

import express from 'express'
import cors from 'cors'
import http from 'http'
import { Server, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { TowerRoom } from './rooms/TowerRoom'

// Constants (must match TowerRoom.ts)
const ROUND_DURATION = 420 // 7 minutes
const BREAK_DURATION = 10  // 10 seconds
const TOTAL_CYCLE = ROUND_DURATION + BREAK_DURATION

console.log('═══════════════════════════════════════════════════════')
console.log('🎮 TOWER OF MADNESS - Colyseus Server')
console.log('═══════════════════════════════════════════════════════')
console.log(`Node.js version: ${process.version}`)
console.log(`⏰ Clock-Based Synchronization: ${ROUND_DURATION/60} min rounds`)
console.log('')

// Calculate current round info
function getCurrentRoundInfo() {
  const now = Math.floor(Date.now() / 1000)
  const roundNumber = Math.floor(now / TOTAL_CYCLE)
  const cycleProgress = now % TOTAL_CYCLE
  const isBreak = cycleProgress >= ROUND_DURATION
  const remainingTime = isBreak 
    ? TOTAL_CYCLE - cycleProgress 
    : ROUND_DURATION - cycleProgress
  
  return { roundNumber, isBreak, remainingTime }
}

// Create Express app with CORS enabled for ALL origins and methods
const app = express()

// CRITICAL: CORS must allow POST for matchmaking
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}))

// Handle preflight requests explicitly
app.options('*', cors())

app.use(express.json())

// Request logging middleware (with body for POST)
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`)
  if (req.method === 'POST' && req.body) {
    console.log(`[HTTP] Body:`, JSON.stringify(req.body))
  }
  next()
})

// Health check endpoints
app.get('/', (req, res) => {
  const info = getCurrentRoundInfo()
  const mins = Math.floor(info.remainingTime / 60)
  const secs = info.remainingTime % 60
  
  res.json({
    name: 'Tower of Madness Server',
    status: 'running',
    timestamp: new Date().toISOString(),
    currentRound: info.roundNumber,
    roundState: info.isBreak ? 'BREAK' : 'ACTIVE',
    timeRemaining: `${mins}:${secs.toString().padStart(2, '0')}`
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Test route to verify POST requests work
app.post('/test', (req, res) => {
  console.log('[TEST] POST /test received')
  res.json({ message: 'POST works!', body: req.body })
})

// 404 handler for debugging
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.url} - Route not found`)
  res.status(404).json({ error: 'Route not found', method: req.method, url: req.url })
})

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[ERROR] Express error:', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

// Create HTTP server from Express
const httpServer = http.createServer(app)

// Get port from environment
const PORT = parseInt(process.env.PORT || '2567', 10)

// Create Colyseus game server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 3000,
    pingMaxRetries: 3
  })
})

// Register the tower room
gameServer.define('tower_room', TowerRoom)
  .enableRealtimeListing()

console.log('📦 Room "tower_room" defined')

// Ensure matchMaker is attached to gameServer
// In @colyseus/core, matchMaker should work standalone, but let's verify
console.log('🔧 MatchMaker initialized:', typeof matchMaker !== 'undefined')

// Add matchmaking routes manually (required for @colyseus/core)
console.log('🔧 Registering matchmaking routes...')
// IMPORTANT: These routes must be registered BEFORE httpServer.listen()
app.post('/matchmake/joinOrCreate/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params
    const options = req.body || {}
    
    console.log(`[Matchmaking] ═══════════════════════════════════`)
    console.log(`[Matchmaking] joinOrCreate request for "${roomName}"`)
    console.log(`[Matchmaking] Options:`, JSON.stringify(options))
    console.log(`[Matchmaking] Headers:`, JSON.stringify(req.headers))
    
    // Use matchMaker directly (imported from @colyseus/core)
    // joinOrCreate returns SeatReservation with room property
    const reservation = await matchMaker.joinOrCreate(roomName, options)
    
    console.log(`[Matchmaking] ✅ Reservation:`, JSON.stringify({
      roomId: reservation.room?.roomId,
      sessionId: reservation.sessionId
    }))
    
    if (!reservation || !reservation.room) {
      throw new Error('Invalid reservation returned from matchMaker')
    }
    
    res.json({
      room: {
        roomId: reservation.room.roomId,
        sessionId: reservation.sessionId
      }
    })
  } catch (error: any) {
    console.error('[Matchmaking] ❌ Error:', error?.message || error)
    console.error('[Matchmaking] Stack:', error?.stack)
    res.status(500).json({ error: error?.message || 'Matchmaking failed' })
  }
})

console.log('✅ Matchmaking route /matchmake/joinOrCreate/:roomName registered')

// Also add a direct route without parameter (some clients might use this)
app.post('/matchmake/joinOrCreate/tower_room', async (req, res) => {
  // Forward to the parameterized route
  req.params = { roomName: 'tower_room' }
  // Re-use the same handler logic
  try {
    const options = req.body || {}
    console.log(`[Matchmaking] Direct joinOrCreate for tower_room`)
    console.log(`[Matchmaking] Options:`, JSON.stringify(options))
    
    const reservation = await matchMaker.joinOrCreate('tower_room', options)
    
    if (!reservation || !reservation.room) {
      throw new Error('Invalid reservation returned from matchMaker')
    }
    
    console.log(`[Matchmaking] ✅ Room: ${reservation.room.roomId}`)
    
    res.json({
      room: {
        roomId: reservation.room.roomId,
        sessionId: reservation.sessionId
      }
    })
  } catch (error: any) {
    console.error('[Matchmaking] ❌ Error:', error?.message || error)
    res.status(500).json({ error: error?.message || 'Matchmaking failed' })
  }
})

console.log('✅ Matchmaking route /matchmake/joinOrCreate/tower_room (direct) registered')

app.post('/matchmake/create/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params
    const options = req.body || {}
    
    console.log(`[Matchmaking] create request for "${roomName}"`)
    
    const reservation = await matchMaker.createRoom(roomName, options)
    
    res.json({
      room: {
        roomId: reservation.room.roomId,
        sessionId: reservation.sessionId
      }
    })
  } catch (error: any) {
    console.error('[Matchmaking] Error:', error)
    res.status(500).json({ error: error?.message || 'Matchmaking failed' })
  }
})

app.post('/matchmake/join/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params
    const options = req.body || {}
    
    console.log(`[Matchmaking] join request for "${roomName}"`)
    
    const reservation = await matchMaker.join(roomName, options)
    
    res.json({
      room: {
        roomId: reservation.room.roomId,
        sessionId: reservation.sessionId
      }
    })
  } catch (error: any) {
    console.error('[Matchmaking] Error:', error)
    res.status(500).json({ error: error?.message || 'Matchmaking failed' })
  }
})

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught Exception:', error)
})

// Start the server
httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`✅ Server listening on 0.0.0.0:${PORT}`)
  console.log(`📡 External URL: wss://towerofmadness-production.up.railway.app`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')
  
  const info = getCurrentRoundInfo()
  console.log(`⏰ Current round: #${info.roundNumber}`)
  console.log(`📍 State: ${info.isBreak ? 'BREAK' : 'ACTIVE'} (${info.remainingTime}s remaining)`)
  console.log('')
  
  // Create persistent room at startup so timer runs immediately
  // This ensures the timer starts even before any players join
  setTimeout(async () => {
    try {
      console.log('🔧 Creating persistent game room for timer...')
      // Use joinOrCreate which will create if it doesn't exist
      // We use a dummy session to trigger room creation
      const reservation = await matchMaker.joinOrCreate('tower_room', { 
        _dummy: true // Mark as dummy so we know it's not a real player
      })
      
      if (reservation && reservation.room) {
        console.log(`🎮 Room created/ready: ${reservation.room.roomId}`)
        console.log('⏱️ Timer will start running once room initializes!')
      } else {
        console.log('⚠️ Room reservation incomplete, but room may still exist')
      }
    } catch (error: any) {
      console.error('❌ Failed to pre-create room:', error?.message || error)
      console.log('ℹ️ Room will be created when first player joins')
    }
  }, 2000) // Wait 2 seconds for server to fully initialize
  
  console.log('🌍 All players worldwide sync to UTC clock!')
  console.log('🎯 Server ready! Waiting for players...')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Shutting down...')
  gameServer.gracefullyShutdown()
})

process.on('SIGINT', () => {
  console.log('📴 Shutting down...')
  gameServer.gracefullyShutdown()
})
