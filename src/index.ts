import {} from '@dcl/sdk/math'
import { engine, Transform, TriggerArea, triggerAreaEventsSystem, ColliderLayer, PointerEvents, PointerEventType, InputAction, pointerEventsSystem, AudioSource, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { EntityNames } from '../assets/scene/entity-names'
import { setupUi } from './ui'
import { generateTower, generateTowerFromServer } from './towerGenerator'
import {
  initMultiplayer,
  isServer,
  isMultiplayerAvailable,
  setupServer,
  setupClient,
  setOnServerTowerReady,
  setOnTimerUpdate,
  setOnLeaderboardUpdate,
  setOnGameEnded,
  setOnRoundChanged,
  sendHeightUpdate,
  sendPlayerFinished,
  sendPlayerDied,
  sendPlayerJoined,
  getRoundInfo,
  checkClockUpdate,
  LeaderboardEntry,
  WinnerEntry,
  RoundInfo
} from './multiplayer'

// ============================================
// GAME STATE - Tower of Hell Style
// ============================================

// Player tracking
export let playerHeight = 0
export let playerMaxHeight = 0 // Max height in current attempt

// Player attempt state (personal, not global)
export enum AttemptState {
  NOT_STARTED = 'NOT_STARTED',   // Player hasn't entered TriggerStart yet
  IN_PROGRESS = 'IN_PROGRESS',   // Player is climbing
  FINISHED = 'FINISHED',         // Player reached TriggerEnd
  DIED = 'DIED'                  // Player entered TriggerDeath
}

export let attemptState: AttemptState = AttemptState.NOT_STARTED
export let attemptStartTime: number = 0     // When player started their attempt
export let attemptTimer: number = 0          // Player's personal attempt time (seconds)
export let attemptFinishTime: number = 0     // Final time if finished

// Personal best
export let bestAttemptTime: number = 0       // Best time to complete
export let bestAttemptHeight: number = 0     // Best max height reached

// Result display
export let attemptResult: 'WIN' | 'DEATH' | null = null
export let resultMessage: string = ''
export let resultTimestamp: number = 0

// ============================================
// GLOBAL ROUND STATE (Server-controlled in multiplayer)
// ============================================

export enum RoundState {
  ACTIVE = 'ACTIVE',           // Round is active, players can climb
  ENDING = 'ENDING',           // Round just ended, showing winners
  BREAK = 'BREAK'              // 10-second break before next round
}

export let roundState: RoundState = RoundState.ACTIVE
export let roundTimer: number = 420           // 7 minutes = 420 seconds (countdown)
export let roundSpeedMultiplier: number = 1.0 // Timer speed (1x, 2x, 3x...)
export let roundStartTime: number = Date.now()
export let roundFinishers: number = 0         // How many players finished this round

// Leaderboard & Winners
export let leaderboard: LeaderboardEntry[] = []
export let roundWinners: WinnerEntry[] = []

// Multiplayer state
export let isMultiplayerMode = false

// Height update throttling
let lastHeightUpdateTime = 0
const HEIGHT_UPDATE_INTERVAL = 500

// ============================================
// HELPER FUNCTIONS
// ============================================

function getWorldPosition(entity: Entity): Vector3 {
  if (!Transform.has(entity)) return Vector3.Zero()
  
  const transform = Transform.get(entity)
  let localPos = transform.position
  
  if (transform.parent !== undefined && transform.parent !== engine.RootEntity && Transform.has(transform.parent)) {
    const parentTransform = Transform.get(transform.parent)
    const parentRot = parentTransform.rotation
    const parentScale = parentTransform.scale
    const rotatedPos = Vector3.rotate(localPos, parentRot)
    const scaledPos = Vector3.create(
      rotatedPos.x * parentScale.x,
      rotatedPos.y * parentScale.y,
      rotatedPos.z * parentScale.z
    )
    const parentWorldPos = getWorldPosition(transform.parent)
    return Vector3.add(scaledPos, parentWorldPos)
  }
  
  return localPos
}

// ============================================
// PLAYER TRACKING SYSTEM
// ============================================

function trackPlayerHeight() {
  if (!Transform.has(engine.PlayerEntity)) return
  
  const playerTransform = Transform.get(engine.PlayerEntity)
  playerHeight = playerTransform.position.y
  
  // Track max height during active attempt
  if (attemptState === AttemptState.IN_PROGRESS) {
    if (playerHeight > playerMaxHeight) {
      playerMaxHeight = playerHeight
    }
    
    // Update attempt timer
    attemptTimer = (Date.now() - attemptStartTime) / 1000
    
    // Send height updates to server (throttled)
    if (isMultiplayerMode) {
      const now = Date.now()
      if (now - lastHeightUpdateTime >= HEIGHT_UPDATE_INTERVAL) {
        sendHeightUpdate(playerMaxHeight)
        lastHeightUpdateTime = now
      }
    }
  }
}

// ============================================
// GLOBAL ROUND TIMER SYSTEM (Single-player only)
// ============================================

function updateRoundTimer() {
  // Handle state transitions (works for both single and multiplayer)
  if (roundState === RoundState.ENDING) {
    // Show results for 3 seconds, then transition to break
    const elapsedSinceEnd = (Date.now() - resultTimestamp) / 1000
    if (elapsedSinceEnd >= 3) {
      roundState = RoundState.BREAK
      resultMessage = '⏳ Next round in 10 seconds...'
      resultTimestamp = Date.now()
    }
    return
  }
  
  if (roundState === RoundState.BREAK) {
    // In multiplayer, server handles new round start
    // In single player, we start new round after 10 seconds
    if (!isMultiplayerMode) {
      const breakElapsed = (Date.now() - resultTimestamp) / 1000
      if (breakElapsed >= 10) {
        startNewRound()
      }
    }
    return
  }
  
  // Active round timer (single player only - multiplayer gets timer from server)
  if (roundState === RoundState.ACTIVE && !isMultiplayerMode) {
    const elapsed = (Date.now() - roundStartTime) / 1000
    const adjustedElapsed = elapsed * roundSpeedMultiplier
    roundTimer = Math.max(0, 420 - adjustedElapsed) // 7 min countdown
    
    // Round ended?
    if (roundTimer <= 0) {
      endRound()
    }
  }
}

// ============================================
// ROUND MANAGEMENT (Single-player)
// ============================================

function startNewRound() {
  console.log('[Game] ═══════════════════════════════════')
  console.log('[Game] 🎮 NEW ROUND STARTING!')
  console.log('[Game] ═══════════════════════════════════')
  
  roundState = RoundState.ACTIVE
  roundTimer = 420 // 7 minutes
  roundSpeedMultiplier = 1.0
  roundStartTime = Date.now()
  roundFinishers = 0
  roundWinners = []
  leaderboard = []
  
  // Reset player attempt
  attemptState = AttemptState.NOT_STARTED
  attemptTimer = 0
  playerMaxHeight = 0
  attemptResult = null
  resultMessage = '🎮 New round started! Go to TriggerStart to begin your attempt'
  resultTimestamp = Date.now()
  
  // Generate new tower
  generateTower()
}

function endRound() {
  console.log('[Game] ═══════════════════════════════════')
  console.log('[Game] 🏁 ROUND ENDED!')
  console.log('[Game] ═══════════════════════════════════')
  
  roundState = RoundState.ENDING
  resultMessage = '🏁 Round Complete!'
  resultTimestamp = Date.now()
  
  // The updateRoundTimer system will handle transitioning to BREAK state
  // after 3 seconds based on resultTimestamp
}

// ============================================
// PLAYER ATTEMPT FUNCTIONS
// ============================================

// Called when player enters TriggerStart
function startAttempt() {
  // Only start if round is active and player hasn't finished this round
  if (roundState !== RoundState.ACTIVE) {
    console.log('[Game] Cannot start attempt - round not active')
    return
  }
  
  // Allow restart if died, or if not started yet
  if (attemptState === AttemptState.FINISHED) {
    console.log('[Game] Already finished this round!')
    resultMessage = '✅ You already finished! Wait for next round.'
    resultTimestamp = Date.now()
    return
  }
  
  console.log('[Game] ========== ATTEMPT STARTED! ==========')
  attemptState = AttemptState.IN_PROGRESS
  attemptStartTime = Date.now()
  attemptTimer = 0
  playerMaxHeight = playerHeight
  attemptResult = null
  resultMessage = '🏃 GO! Climb to the top!'
  resultTimestamp = Date.now()
}

// Called when player reaches TriggerEnd
function finishAttempt() {
  if (attemptState !== AttemptState.IN_PROGRESS) return
  if (roundState !== RoundState.ACTIVE) return
  
  console.log('[Game] ========== ATTEMPT FINISHED! ==========')
  attemptState = AttemptState.FINISHED
  attemptFinishTime = attemptTimer
  attemptResult = 'WIN'
  resultMessage = `🏆 FINISHED! Time: ${attemptTimer.toFixed(2)}s`
  resultTimestamp = Date.now()
  
  // Update personal best
  if (attemptFinishTime < bestAttemptTime || bestAttemptTime === 0) {
    bestAttemptTime = attemptFinishTime
  }
  if (playerMaxHeight > bestAttemptHeight) {
    bestAttemptHeight = playerMaxHeight
  }
  
  // Speed up the round timer!
  roundFinishers++
  roundSpeedMultiplier = roundFinishers + 1
  console.log(`[Game] Timer speed now: x${roundSpeedMultiplier}`)
  
  // Send to server
  if (isMultiplayerMode) {
    sendPlayerFinished(attemptFinishTime, playerMaxHeight)
  }
}

// Called when player enters TriggerDeath
function dieAttempt() {
  if (attemptState !== AttemptState.IN_PROGRESS) return
  
  console.log('[Game] ========== PLAYER DIED! ==========')
  attemptState = AttemptState.DIED
  attemptResult = 'DEATH'
  resultMessage = `☠️ DEATH at ${playerMaxHeight.toFixed(1)}m - Go to TriggerStart to retry!`
  resultTimestamp = Date.now()
  
  // Update personal best height even on death
  if (playerMaxHeight > bestAttemptHeight) {
    bestAttemptHeight = playerMaxHeight
  }
  
  // Send to server
  if (isMultiplayerMode) {
    sendPlayerDied(playerMaxHeight)
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

export async function main() {
  console.log('[Game] ═══════════════════════════════════════════')
  console.log('[Game] 🎮 TOWER OF MADNESS - Starting...')
  console.log('[Game] ═══════════════════════════════════════════')
  
  // ============================================
  // MULTIPLAYER INITIALIZATION (with fallback)
  // ============================================
  
  try {
    console.log('[Game] ⏰ Initializing clock-based sync...')
    
    // Try to initialize multiplayer (may fail in some environments)
    let serverConnected = false
    try {
      serverConnected = await initMultiplayer()
      isMultiplayerMode = true
      
      if (serverConnected) {
        console.log('[Multiplayer] ✅ Connected to server')
        sendPlayerJoined('Player')
      } else {
        console.log('[Multiplayer] ⚠️ Server offline - local mode')
      }
    } catch (mpError) {
      console.error('[Multiplayer] ❌ Failed to initialize:', mpError)
      console.log('[Game] Continuing without multiplayer...')
      isMultiplayerMode = false
    }
    
    // Get initial round info (works even without server)
    let initialRound: RoundInfo
    try {
      initialRound = getRoundInfo()
    } catch (e) {
      // Fallback: generate local round info
      console.log('[Game] Using fallback round generation')
      const now = Math.floor(Date.now() / 1000)
      const roundNumber = Math.floor(now / 430) // 420 + 10 break
      initialRound = {
        roundNumber,
        isBreak: false,
        remainingTime: 420,
        chunkIds: ['Chunk01', 'Chunk02', 'Chunk03'] // Default tower
      }
    }
    
    console.log(`[Game] Round #${initialRound.roundNumber}`)
    console.log(`[Game] Tower: [${initialRound.chunkIds.join(' → ')}]`)
    
    // Set up round state
    roundState = initialRound.isBreak ? RoundState.BREAK : RoundState.ACTIVE
    roundTimer = initialRound.remainingTime
    
    // GENERATE INITIAL TOWER IMMEDIATELY
    console.log('[Game] 🗼 Generating initial tower...')
    generateTowerFromServer(initialRound.chunkIds)
    
    // Set up callbacks for future rounds (if multiplayer works)
    if (isMultiplayerMode) {
      setOnServerTowerReady((chunkIds: string[]) => {
        console.log('[Game] 🗼 New tower:', chunkIds.join(' → '))
        generateTowerFromServer(chunkIds)
        
        attemptState = AttemptState.NOT_STARTED
        attemptTimer = 0
        playerMaxHeight = 0
        attemptResult = null
        roundState = RoundState.ACTIVE
        resultMessage = '🎮 New round! Go to TriggerStart to begin'
        resultTimestamp = Date.now()
      })
      
      setOnTimerUpdate((remaining: number, speedMult: number) => {
        roundTimer = remaining
        roundSpeedMultiplier = speedMult
        
        if (remaining <= 0 && roundState === RoundState.ACTIVE) {
          roundState = RoundState.BREAK
          resultMessage = '⏳ Round ended! Next round starting soon...'
          resultTimestamp = Date.now()
        }
      })
      
      setOnRoundChanged((info: RoundInfo) => {
        console.log(`[Game] 🔄 Round #${info.roundNumber}`)
        if (info.isBreak) {
          roundState = RoundState.BREAK
        }
      })
      
      setOnLeaderboardUpdate((players: LeaderboardEntry[]) => {
        leaderboard = players
      })
    }
  } catch (initError) {
    console.error('[Game] ❌ Initialization error:', initError)
    console.log('[Game] Falling back to single-player mode...')
    isMultiplayerMode = false
    roundState = RoundState.ACTIVE
    roundTimer = 420
    
    // Generate default tower
    generateTower()
  }
  
  // Leaderboard updates (from server)
  setOnLeaderboardUpdate((players: LeaderboardEntry[]) => {
    leaderboard = players
  })
  
  // Round end with winners (from server)
  setOnGameEnded((winners: WinnerEntry[]) => {
    roundState = RoundState.ENDING
    roundWinners = winners
    resultMessage = '🏁 Round Complete!'
    resultTimestamp = Date.now()
  })
  
  // ============================================
  // TRIGGER SETUP
  // ============================================
  
  const triggerStart = engine.getEntityOrNullByName(EntityNames.TriggerStart)
  const triggerEnd = engine.getEntityOrNullByName(EntityNames.TriggerEnd)
  const triggerDeath = engine.getEntityOrNullByName(EntityNames.TriggerDeath)
  
  console.log('[Triggers] Start:', triggerStart ? '✅' : '❌')
  console.log('[Triggers] End:', triggerEnd ? '✅' : '❌')
  console.log('[Triggers] Death:', triggerDeath ? '✅' : '❌')
  
  // Setup TriggerStart
  if (triggerStart) {
    if (Transform.has(triggerStart)) {
      const transform = Transform.getMutable(triggerStart)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(triggerStart, ColliderLayer.CL_PLAYER)
  }
  
  // Setup TriggerEnd
  if (triggerEnd) {
    if (Transform.has(triggerEnd)) {
      const transform = Transform.getMutable(triggerEnd)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(triggerEnd, ColliderLayer.CL_PLAYER)
  }
  
  // Setup TriggerDeath
  if (triggerDeath) {
    if (Transform.has(triggerDeath)) {
      const transform = Transform.getMutable(triggerDeath)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(triggerDeath, ColliderLayer.CL_PLAYER)
  }
  
  // ============================================
  // MANUAL TRIGGER DETECTION SYSTEM
  // ============================================
  
  let inTriggerStart = false
  let inTriggerEnd = false
  let inTriggerDeath = false
  
  engine.addSystem(() => {
    if (!Transform.has(engine.PlayerEntity)) return
    const playerPos = Transform.get(engine.PlayerEntity).position
    
    // Check TriggerStart
    if (triggerStart && Transform.has(triggerStart)) {
      const t = Transform.get(triggerStart)
      const inside = isInsideBox(playerPos, t.position, t.scale)
      
      if (inside && !inTriggerStart) {
        inTriggerStart = true
        startAttempt()
      } else if (!inside && inTriggerStart) {
        inTriggerStart = false
      }
    }
    
    // Check TriggerEnd (only during attempt)
    if (triggerEnd && Transform.has(triggerEnd)) {
      const t = Transform.get(triggerEnd)
      const worldPos = getWorldPosition(triggerEnd)
      const inside = isInsideBox(playerPos, worldPos, t.scale)
      
      if (inside && !inTriggerEnd) {
        inTriggerEnd = true
        finishAttempt()
      } else if (!inside && inTriggerEnd) {
        inTriggerEnd = false
      }
    }
    
    // Check TriggerDeath (only during attempt)
    if (triggerDeath && Transform.has(triggerDeath)) {
      const t = Transform.get(triggerDeath)
      const inside = isInsideBox(playerPos, t.position, t.scale)
      
      if (inside && !inTriggerDeath) {
        inTriggerDeath = true
        dieAttempt()
      } else if (!inside && inTriggerDeath) {
        inTriggerDeath = false
      }
    }
  })
  
  function isInsideBox(pos: Vector3, center: Vector3, scale: Vector3): boolean {
    const dx = Math.abs(pos.x - center.x)
    const dy = Math.abs(pos.y - center.y)
    const dz = Math.abs(pos.z - center.z)
    return dx <= scale.x / 2 && dy <= scale.y / 2 && dz <= scale.z / 2
  }
  
  // ============================================
  // ADD SYSTEMS
  // ============================================
  
  engine.addSystem(trackPlayerHeight)
  engine.addSystem(updateRoundTimer)
  
  // Clock sync system (updates timer from UTC clock)
  engine.addSystem(() => {
    checkClockUpdate()
  })
  
  // Debug log every 5 seconds
  let lastDebugLog = 0
  engine.addSystem(() => {
    const now = Date.now()
    if (now - lastDebugLog > 5000) {
      const mins = Math.floor(roundTimer / 60)
      const secs = Math.floor(roundTimer % 60)
      console.log(`[Game] Round: ${roundState} | Timer: ${mins}:${secs.toString().padStart(2, '0')} x${roundSpeedMultiplier} | Attempt: ${attemptState}`)
      lastDebugLog = now
    }
  })
  
  // ============================================
  // INITIALIZE UI
  // ============================================
  
  setupUi()
  
  // ============================================
  // BUTTON PANEL (Manual tower regen - disabled in multiplayer)
  // ============================================
  
  const buttonPanel = engine.getEntityOrNullByName(EntityNames.Button_Panel)
  if (buttonPanel && !isMultiplayerMode) {
    if (!PointerEvents.has(buttonPanel)) {
      PointerEvents.create(buttonPanel, {
        pointerEvents: [{
          eventType: PointerEventType.PET_DOWN,
          eventInfo: {
            button: InputAction.IA_POINTER,
            hoverText: 'Regenerate Tower',
            showFeedback: true,
            maxDistance: 10
          }
        }]
      })
    }
    
    pointerEventsSystem.onPointerDown(
      { entity: buttonPanel, opts: { button: InputAction.IA_POINTER, hoverText: 'Regenerate Tower', showFeedback: true, maxDistance: 10 } },
      () => {
        console.log('[Game] Button clicked - regenerating tower...')
        generateTower()
      }
    )
  }
  
  // ============================================
  // INITIAL TOWER (Clock-based - same for everyone!)
  // ============================================
  
  // Tower is generated via setOnServerTowerReady callback
  // which was already called when we set it up above
  console.log('[Game] 🗼 Initial tower generated from round clock')
  
  // ============================================
  // BACKGROUND MUSIC
  // ============================================
  
  setupBackgroundMusic('sounds/PixelSodaBar.mp3')
  
  console.log('[Game] ═══════════════════════════════════════════')
  console.log('[Game] ✅ Setup complete!')
  console.log('[Game] ⏰ Clock-based sync: All players share same tower & timer')
  console.log('[Game] ═══════════════════════════════════════════')
}

// ============================================
// BACKGROUND MUSIC
// ============================================

let backgroundMusicEntity: Entity | null = null
let audioStarted = false

function setupBackgroundMusic(audioPath: string) {
  backgroundMusicEntity = engine.addEntity()
  
  Transform.create(backgroundMusicEntity, {
    position: Vector3.create(40, 0, 40),
    scale: Vector3.One()
  })
  
  AudioSource.create(backgroundMusicEntity, {
    audioClipUrl: audioPath,
    playing: true,
    loop: true,
    volume: 1.0
  })
  
  engine.addSystem(() => {
    if (backgroundMusicEntity && AudioSource.has(backgroundMusicEntity)) {
      const audio = AudioSource.get(backgroundMusicEntity)
      if (!audio.playing && !audioStarted) {
        AudioSource.getMutable(backgroundMusicEntity).playing = true
      } else if (audio.playing && !audioStarted) {
        audioStarted = true
      }
    }
  })
  
  return backgroundMusicEntity
}

export function playSoundEffect(audioPath: string, volume: number = 1.0) {
  const soundEntity = engine.addEntity()
  AudioSource.create(soundEntity, {
    audioClipUrl: audioPath,
    playing: true,
    loop: false,
    volume: volume
  })
  return soundEntity
}
