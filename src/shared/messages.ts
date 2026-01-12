import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // Client -> Server: Player joins game (name is looked up server-side from PlayerIdentityData)
  playerJoin: Schemas.Map({}),

  // Client -> Server: Player started attempt (entered start trigger)
  playerStarted: Schemas.Map({}),

  // Client -> Server: Player finished the tower (entered end trigger)
  playerFinished: Schemas.Map({
    time: Schemas.Number
  }),

  // Server -> Client: Broadcast when a player finishes
  playerFinishedBroadcast: Schemas.Map({
    displayName: Schemas.String,
    finishOrder: Schemas.Number,
    speedMultiplier: Schemas.Number,
    time: Schemas.Number // Server-calculated finish time
  }),

  // Client -> Server: Time sync request (NTP-style)
  timeSync: Schemas.Map({
    id: Schemas.String // Unique request ID (sessionId:counter)
  }),

  // Server -> Client: Time sync response
  timeSyncResponse: Schemas.Map({
    id: Schemas.String, // Echo request ID
    t2: Schemas.Int64,  // Server receive time
    t3: Schemas.Int64   // Server send time
  })
}

export const room = registerMessages(Messages)
