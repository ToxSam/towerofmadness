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
import { Server, matchMaker } from 'colyseus'
import { createServer } from 'http'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { monitor } from '@colyseus/monitor'
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

// Create Express app
const app = express()
app.use(cors())
app.use(express.json())

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

// Health check endpoint
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

// Create HTTP server
const httpServer = createServer(app)

// Create Colyseus server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer
  })
})

// Register the tower room
gameServer.define('tower_room', TowerRoom)
  .enableRealtimeListing()

// Colyseus Monitor (admin panel) - only in dev
if (process.env.NODE_ENV !== 'production') {
  app.use('/colyseus', monitor())
  console.log('📊 Colyseus Monitor available at /colyseus')
}

// Get port from environment
const PORT = parseInt(process.env.PORT || '2567', 10)
const HOST = '0.0.0.0'

// Start the server
httpServer.listen(PORT, HOST, async () => {
  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`✅ Server listening on ${HOST}:${PORT}`)
  console.log(`📡 External URL: wss://towerofmadness-production.up.railway.app`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')
  
  // Create the game room at startup
  setTimeout(async () => {
    console.log('🔧 Creating game room...')
    try {
      const room = await matchMaker.createRoom('tower_room', {})
      const info = getCurrentRoundInfo()
      console.log(`🎮 Room created: ${room.roomId}`)
      console.log(`⏰ Current round: #${info.roundNumber}`)
      console.log(`📍 State: ${info.isBreak ? 'BREAK' : 'ACTIVE'} (${info.remainingTime}s remaining)`)
      console.log('')
      console.log('🌍 All players worldwide sync to UTC clock!')
      console.log('🎯 Server ready!')
    } catch (error: any) {
      console.error('❌ Failed to create room:', error?.message || error)
    }
  }, 1000)
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
