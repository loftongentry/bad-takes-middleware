import { pubsub, RoomStore } from "./redis"

export const resolvers = {
  Query: {
    room: (_: unknown, { id }: { id: string }) => {
      return RoomStore.get(id);
    }
  },
  Mutation: {
    createRoom: async (_: unknown, args: any) => {
      const { hostName, lobbyName, rounds, playerLimit, timeLimit } = args;
      const settings = { lobbyName, rounds, playerLimit, timeLimit };

      const createdRoom = await RoomStore.create(hostName, settings);
      if (!createdRoom) throw new Error("Failed to create room");

      const { id, ...room } = createdRoom;
      return { room: { id, ...room }, hostId: room.players[0]?.id };
    },
    joinRoom: async (_: unknown, { code, playerName }: { code: string; playerName: string }) => {
      const { room, playerId } = await RoomStore.join(code, playerName);
      return { room, playerId }
    },
    leaveRoom: async (_: unknown, { roomId, playerId }: { roomId: string; playerId: string }) => {
      return await RoomStore.leave(roomId, playerId);
    },
    kickPlayer: async (_: unknown, { roomId, playerId }: { roomId: string; playerId: string }) => {
      return await RoomStore.kick(roomId, playerId);
    },
    startGame: async (_: unknown, { roomId }: { roomId: string }) => {
      return await RoomStore.startGame(roomId);
    },
    submitPrompt: async (_: unknown, { roomId, playerId, prompt }: { roomId: string; playerId: string; prompt: string }) => {
      return await RoomStore.submitPrompt(roomId, playerId, prompt);
    },
    endTurn: async (_: unknown, { roomId }: { roomId: string }) => {
      return await RoomStore.endTurn(roomId);
    },
    submitVote: async (_: unknown, { roomId, playerId, value }: { roomId: string; playerId: string; value: number }) => {
      return await RoomStore.submitVote(roomId, playerId, value);
    },
    resetGame: async (_: unknown, { roomId }: { roomId: string }) => {
      return await RoomStore.resetGame(roomId);
    }
  },
  Subscription: {
    room: {
      subscribe: (_: unknown, { roomId }: { roomId: string }) => {
        return pubsub.asyncIterator(`ROOM:${roomId}`);
      }
    }
  }
}