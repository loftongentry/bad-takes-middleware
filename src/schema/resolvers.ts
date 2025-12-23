import type { RedisRoomStore } from "../store/roomStore";
import type { RedisEventBus } from "../events/eventBus";
import { resolve } from "node:dns";

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
      ping: async (_: unknown, { message }: { message: string }) => {
        const payload = `pong: ${message}`;
        await events.publishPing('ping', payload);
        return payload;
      },

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
      }
    },
    Subscription: {
      pinged: {
        subscribe: () => events.subscribePing(),
        resolve: (payload: { pinged: string }) => payload.pinged,
      },

      roomUpdated: {
        // IMPORTANT: roomId selects a *room-specific* topic, so no filtering required.
        subscribe: (_: unknown, { roomId }: { roomId: string }) => {
          return events.subscribeRoomUpdated(roomId);
        },
        resolve: (payload: { roomUpdated: any }) => {
          return payload.roomUpdated;
        }
      }
    }
  }
}