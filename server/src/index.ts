/**
 * Tower of Madness - Colyseus Multiplayer Server
 * 
 * This server manages:
 * - Tower generation (same chunks for all players)
 * - 7-minute round timer with speed multiplier
 * - Player leaderboard and height tracking
 * - Winner determination and new round scheduling
 * 
 * Deploy to Railway:
 * 1. Push to GitHub
 * 2. Connect Railway to repo
 * 3. Set root directory to /server
 * 4. Railway auto-deploys and provides wss:// URL
 */

import express from 'express'
import cors from 'cors'
import { Server } from 'colyseus'
import { createServer } from 'http'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { monitor } from '@colyseus/monitor'
import { TowerRoom } from './rooms/TowerRoom'

console.log('═══════════════════════════════════════════════════════')
console.log('🎮 TOWER OF MADNESS - Colyseus Server')
console.log('═══════════════════════════════════════════════════════')
console.log(`Node.js version: ${process.version}`)
console.log('')

// Create Express app
const app = express()
app.use(cors())
app.use(express.json())

// Health check endpoint (for Railway/monitoring)
app.get('/', (req, res) => {
  res.json({
    name: 'Tower of Madness Server',
    status: 'running',
    timestamp: new Date().toISOString()
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

// Get port from environment (Railway sets this) or use default
const PORT = parseInt(process.env.PORT || '2567', 10)

// Start the server
httpServer.listen(PORT, () => {
  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`✅ Server listening on port ${PORT}`)
  console.log(`📡 WebSocket URL: ws://localhost:${PORT}`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')
  console.log('Room: "tower_room" registered')
  console.log('')
  console.log('Waiting for players to connect...')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('')
  console.log('📴 Received SIGTERM, shutting down gracefully...')
  gameServer.gracefullyShutdown()
})

process.on('SIGINT', () => {
  console.log('')
  console.log('📴 Received SIGINT, shutting down gracefully...')
  gameServer.gracefullyShutdown()
})
