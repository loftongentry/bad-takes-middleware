import type { RedisRoomStore } from "../store/roomStore";
import type { RedisEventBus } from "../events/eventBus";

export function makeResolvers(deps: { store: RedisRoomStore; events: RedisEventBus }) {
  const { store, events } = deps;

  return {
    Query: {
      health: () => 'OK',

      roomById: (_: unknown, { roomId }: { roomId: string }) => {
        return store.getRoomById(roomId);
      },

      roomByJoinCode: (_: unknown, { joinCode }: { joinCode: string }) => {
        return store.getRoomByJoinCode(joinCode);
      }
    },
    Mutation: {
      createRoom: async (_: unknown, args: {
        hostName: string;
        lobbyName: string;
        rounds: number;
        playerLimit: number;
        timeLimit: number;
      }) => {
        const payload = await store.createRoom(args);
        await events.publishRoomUpdated(payload.room);
        return payload;
      },

      joinRoom: async (_: unknown, args: { joinCode: string; playerName: string }) => {
        const payload = await store.joinRoom(args);
        await events.publishRoomUpdated(payload.room);
        return payload;
      },

      leaveRoom: async (_: unknown, { roomId, playerId }: { roomId: string; playerId: string }) => {
        const payload = await store.leaveRoom(roomId, playerId);

        if (payload.closed) {
          await events.publishRoomClosed(roomId);
        } else if (payload.room) {
          await events.publishRoomUpdated(payload.room);
        }

        return payload;
      },

      kickPlayer: async (_: unknown, { roomId, playerId }: { roomId: string; playerId: string }) => {
        const room = await store.kickPlayer(roomId, playerId);
        await events.publishRoomUpdated(room);
        return room;
      },
      
      startGame: async (_: unknown, { roomId }: { roomId: string }) => {
        const room = await store.startGame(roomId);
        await events.publishRoomUpdated(room);
        return room;
      }
    },
    Subscription: {
      roomUpdated: {
        // IMPORTANT: roomId selects a *room-specific* topic, so no filtering required.
        subscribe: (_: unknown, { roomId }: { roomId: string }) => {
          return events.subscribeRoomUpdated(roomId);
        },
        resolve: (payload: { roomUpdated: any }) => {
          return payload.roomUpdated;
        }
      },
      roomClosed: {
        subscribe: (_: unknown, { roomId }: { roomId: string }) => {
          return events.subscribeRoomClosed(roomId);
        },
        resolve: (payload: { roomClosed: any }) => {
          return payload.roomClosed;
        }
      }
    }
  }
}