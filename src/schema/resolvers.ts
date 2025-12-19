import { pubsub, TOPICS, publishPinged, publishRoomUpdated } from '../pubsub.js'
import { createRoom, getRoomById, getRoomByJoinCode, joinRoom } from '../store/roomStore.js'

export const resolvers = {
  Query: {
    // Simple “is the server alive” check
    health: () => 'OK',

    roomById: (_: unknown, { roomId }: { roomId: string }) => getRoomById(roomId),
    roomByJoinCode: (_: unknown, { joinCode }: { joinCode: string }) => getRoomByJoinCode(joinCode),
  },

  Mutation: {
    // Used to prove HTTP + WS works; keeps debugging easy.
    ping: async (_: unknown, { message }: { message: string }) => {
      const payload = `pong: ${message}`
      await publishPinged(payload)
      return payload
    },

    // Host creates a room and becomes the first player.
    createRoom: async (
      _: unknown,
      args: {
        hostName: string
        lobbyName: string
        rounds: number
        playerLimit: number
        timeLimit: number
      }
    ) => {
      const payload = createRoom(args)
      // Push the updated room state to anyone subscribed to this room.
      await publishRoomUpdated(payload.room)
      return payload
    },

    // A player joins by join code.
    joinRoom: async (_: unknown, args: { joinCode: string; playerName: string }) => {
      const room = joinRoom(args)
      await publishRoomUpdated(room)
      return room
    },
  },

  Subscription: {
    pinged: {
      // Broadcasts whenever ping() publishes.
      subscribe: () => pubsub.asyncIterableIterator(TOPICS.PINGED),
    },

    roomUpdated: {
      // Subscribes to a room-specific topic so only that room’s updates arrive.
      subscribe: (_: unknown, { roomId }: { roomId: string }) =>
        pubsub.asyncIterableIterator(TOPICS.roomUpdated(roomId)),
    },
  },
}
