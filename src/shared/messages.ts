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
  })
}

export const room = registerMessages(Messages)