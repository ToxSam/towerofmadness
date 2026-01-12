/**
 * NTP-Style Time Synchronization Module for Decentraland SDK7
 *
 * Self-contained module for synchronized server time in multiplayer scenes.
 * Works with the Authoritative Server pattern.
 *
 * Usage:
 *
 *   // In your main entry point:
 *   import { initTimeSync, getServerTime, isTimeSyncReady } from './shared/timeSync'
 *
 *   if (isServer()) {
 *     initTimeSync({ isServer: true })
 *   } else {
 *     initTimeSync({ isServer: false })
 *   }
 *
 *   // To get synchronized server time (client-side):
 *   const serverNow = getServerTime()
 */

import { engine, Schemas } from '@dcl/sdk/ecs'
import { RealmInfo } from '@dcl/sdk/ecs'
import { registerMessages, isServer } from '@dcl/sdk/network'

// ============================================
// MESSAGE DEFINITIONS
// ============================================

const TimeSyncMessages = {
  // Client -> Server: Time sync request
  timeSync: Schemas.Map({
    id: Schemas.String // Unique request ID (sessionId:counter)
  }),

  // Server -> Client: Time sync response
  timeSyncResponse: Schemas.Map({
    id: Schemas.String, // Echo request ID
    t2: Schemas.Int64, // Server receive time
    t3: Schemas.Int64 // Server send time
  })
}

// Register messages and get room handle
const timeSyncRoom = registerMessages(TimeSyncMessages)

// ============================================
// CONFIGURATION
// ============================================

const SAMPLES_NEEDED = 5
const SAMPLE_INTERVAL = 0.15 // seconds between samples
const RESYNC_INTERVAL = 60 // seconds between re-syncs

// ============================================
// STATE
// ============================================

let initialized = false
let sessionId: string = ''
let serverTimeOffset = 0
let timeSyncReady = false

// Client sync state
let isSyncing = false
let samples: { offset: number; rtt: number }[] = []
let sampleTimer = 0
let resyncTimer = 0
let requestCounter = 0
let pendingRequestId: string | null = null
let pendingT1: number = 0

// ============================================
// PUBLIC API
// ============================================

interface TimeSyncOptions {
  isServer?: boolean
}

/**
 * Initialize time sync module.
 * Call once at startup - automatically detects server/client mode if not specified.
 */
export function initTimeSync(options?: TimeSyncOptions) {
  if (initialized) {
    console.log('[TimeSync] Already initialized')
    return
  }

  const serverMode = options?.isServer ?? isServer()

  if (serverMode) {
    initServer()
  } else {
    initClient()
  }

  initialized = true
}

/**
 * Get the current synchronized server time.
 * On server: returns Date.now() directly
 * On client: returns Date.now() + calculated offset
 */
export function getServerTime(): number {
  return Date.now() + serverTimeOffset
}

/**
 * Check if time sync is ready (has completed initial synchronization).
 * Always true on server.
 */
export function isTimeSyncReady(): boolean {
  return timeSyncReady
}

/**
 * Get the calculated time offset in milliseconds.
 * Positive = client is behind server, Negative = client is ahead
 */
export function getTimeSyncOffset(): number {
  return serverTimeOffset
}

// ============================================
// SERVER IMPLEMENTATION
// ============================================

function initServer() {
  console.log('[TimeSync] Initializing server-side handler')

  timeSyncRoom.onMessage('timeSync', (data, context) => {
    if (!context) return

    const t2 = Date.now()
    const t3 = Date.now()

    console.log(`[TimeSync] Server received sync request from ${context.from}, responding with t2=${t2}, t3=${t3}`)

    timeSyncRoom.send(
      'timeSyncResponse',
      {
        id: data.id,
        t2: t2,
        t3: t3
      },
      { to: [context.from] }
    )
  })

  // Server is always "synced" - it is the source of truth
  timeSyncReady = true
  serverTimeOffset = 0
}

// ============================================
// CLIENT IMPLEMENTATION
// ============================================

function initClient() {
  console.log('[TimeSync] Initializing client-side sync')

  sessionId = generateSessionId()
  timeSyncRoom.onMessage('timeSyncResponse', handleResponse)
  engine.addSystem(timeSyncSystem, undefined, 'ntp-time-sync')
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function isRoomConnected(): boolean {
  const realmInfo = RealmInfo.getOrNull(engine.RootEntity)
  return realmInfo?.isConnectedSceneRoom ?? false
}

function sendRequest() {
  requestCounter++
  pendingRequestId = `${sessionId}:${requestCounter}`
  pendingT1 = Date.now()

  console.log(`[TimeSync] Client sending sync request: ${pendingRequestId}`)
  timeSyncRoom.send('timeSync', { id: pendingRequestId })
}

function handleResponse(data: { id: string; t2: number; t3: number }) {
  console.log(`[TimeSync] Client received response: id=${data.id}, pending=${pendingRequestId}`)

  // Ignore responses that don't match our pending request
  if (data.id !== pendingRequestId) {
    console.log(`[TimeSync] Ignoring response - id mismatch`)
    return
  }

  const t4 = Date.now()
  const t1 = pendingT1
  const t2 = data.t2
  const t3 = data.t3

  pendingRequestId = null

  const rtt = t4 - t1 - (t3 - t2)
  const offset = (t2 - t1 + (t3 - t4)) / 2

  console.log(`[TimeSync] Sample ${samples.length + 1}/${SAMPLES_NEEDED}: rtt=${rtt}ms, offset=${offset.toFixed(0)}ms`)
  samples.push({ offset, rtt })

  if (samples.length >= SAMPLES_NEEDED) {
    finalizeSamples()
  }
}

function finalizeSamples() {
  // Sort by RTT, remove outliers (best and worst)
  samples.sort((a, b) => a.rtt - b.rtt)
  const validSamples = samples.slice(1, -1)

  // Average the offsets
  serverTimeOffset = validSamples.reduce((sum, s) => sum + s.offset, 0) / validSamples.length

  console.log(`[TimeSync] Synchronized, offset: ${serverTimeOffset.toFixed(0)}ms`)

  samples = []
  isSyncing = false
  timeSyncReady = true
  resyncTimer = 0
}

function startSync() {
  isSyncing = true
  samples = []
  sampleTimer = SAMPLE_INTERVAL // Send immediately
  pendingRequestId = null
}

function timeSyncSystem(dt: number) {
  if (!isRoomConnected()) return

  // Start initial sync when room connects
  if (!timeSyncReady && !isSyncing) {
    startSync()
    return
  }

  // Currently collecting samples
  if (isSyncing) {
    sampleTimer += dt

    // Timeout waiting for response
    if (pendingRequestId !== null && sampleTimer > 2) {
      pendingRequestId = null
      sampleTimer = 0
    }

    // Send next sample request
    if (pendingRequestId === null && sampleTimer >= SAMPLE_INTERVAL) {
      sampleTimer = 0
      sendRequest()
    }
    return
  }

  // Periodic re-sync (only when not currently syncing)
  resyncTimer += dt
  if (resyncTimer >= RESYNC_INTERVAL) {
    resyncTimer = 0
    startSync()
  }
}
