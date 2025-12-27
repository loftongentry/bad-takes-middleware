import Redis from "ioredis";
import { RedisPubSub } from "graphql-redis-subscriptions";
import { v4 as uuid } from "uuid";
import { makeJoinCode } from "./utils/joinCode";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const redis = new Redis(REDIS_URL);

export const pubsub = new RedisPubSub({
  publisher: new Redis(REDIS_URL),
  subscriber: new Redis(REDIS_URL),
});

export type RoomSettings = {
  lobbyName: string
  rounds: number
  playerLimit: number
  timeLimit: number
}

const ONE_HOUR = 60 * 60; // seconds

export const RoomStore = {
  // --- Keys ---
  roomKey: (id: string) => `room:${id}`,
  playersKey: (id: string) => `room:${id}:players`,
  joinKey: (code: string) => `join:${code.toUpperCase()}`,

  // --- Read ---
  async get(roomId: string) {
    // Pipeline: Fetch room metadata + players in one trip
    const [roomRes, playersRes] = await redis
      .pipeline()
      .hgetall(this.roomKey(roomId))
      .hgetall(this.playersKey(roomId))
      .exec() as [any, any]

    const roomData = roomRes[1];
    const playersData = playersRes[1];

    if (!roomData || Object.keys(roomData).length === 0) {
      return null; // Room does not exist
    }

    // Parse players
    const players = Object.values(playersData).map((p: any) => JSON.parse(p));
    // Parse GameState (for future phases)
    const gameState = roomData.gameState ? JSON.parse(roomData.gameState) : null;

    return {
      id: roomId,
      joinCode: roomData.joinCode,
      status: roomData.status,
      settings: {
        lobbyName: roomData.lobbyName || "Default Lobby",
        rounds: Number(roomData.rounds),
        playerLimit: Number(roomData.playerLimit),
        timeLimit: Number(roomData.timeLimit),
      },
      players: players,
      gameState
    };
  },

  // --- Actions ---
  async create(hostName: string, settings: RoomSettings) {
    const roomId = uuid();
    const joinCode = makeJoinCode();

    const host = { id: uuid(), name: hostName, isHost: true, score: 0 };

    // Flatten settings into room hash for easy reading
    const roomMeta = {
      id: roomId,
      joinCode,
      status: "LOBBY",
      lobbyName: settings.lobbyName,
      rounds: settings.rounds,
      playerLimit: settings.playerLimit,
      timeLimit: settings.timeLimit,
      gameState: JSON.stringify({
        prompts: [],
        queue: [],
        votes: {},
        currentTurn: null
      })
    }

    await redis.multi()
      .hset(this.roomKey(roomId), roomMeta)
      .expire(this.roomKey(roomId), ONE_HOUR)
      .hset(this.playersKey(roomId), host.id, JSON.stringify(host))
      .expire(this.playersKey(roomId), ONE_HOUR)
      .setex(this.joinKey(joinCode), ONE_HOUR, roomId)
      .exec();

    const room = await this.get(roomId);
    await this.publish(room)
    return room
  },

  async join(joinCode: string, playerName: string) {
    const roomId = await redis.get(this.joinKey(joinCode));
    if (!roomId) {
      throw new Error("Invalid join code");
    }

    const room = await this.get(roomId);
    // Error handling for common edge cases
    if (!room) {
      throw new Error("Room not found");
    }
    if (room.status !== "LOBBY") {
      throw new Error("Cannot join, game already started");
    }
    if (room.players.length >= room.settings.playerLimit) {
      throw new Error("Room is full");
    }

    const newPlayer = { id: uuid(), name: playerName, isHost: false, score: 0 };

    await redis.hset(this.playersKey(roomId), newPlayer.id, JSON.stringify(newPlayer));
    const updatedRoom = await this.get(roomId);
    await this.publish(updatedRoom);
    return { room: updatedRoom, playerId: newPlayer.id };
  },

  async leave(roomId: string, playerId: string) {
    const room = await this.get(roomId);
    if (!room) {
      return;
    }

    const player = room.players.find((p: any) => p.id === playerId);
    if (!player) {
      return; // Player not in room
    }

    if (player.isHost) {
      // If host leaves, delete the room entirely
      await redis.multi()
        .del(this.roomKey(roomId))
        .del(this.playersKey(roomId))
        .del(this.joinKey(room.joinCode))
        .exec();
      
      // Notify subscribers that the room is closed and kick everyone out
      await pubsub.publish(`ROOM:${room.id}`, { room: null });
    } else {
      // Remove player from room
      await redis.hdel(this.playersKey(roomId), playerId);
      const updatedRoom = await this.get(roomId);
      await this.publish(updatedRoom);
    }
  },

  async kick(roomId: string, playerId: string) {
    // Check to see if the player is still in the room
    const room = await this.get(roomId);
    if (!room) {
      return;
    }

    const player = room?.players.find((p: any) => p.id === playerId);
    if (!player) {
      return; // Player already left
    }

    // Remove player from room
    await redis.hdel(this.playersKey(roomId), playerId);
    const updatedRoom = await this.get(roomId);
    await this.publish(updatedRoom);
  },

  async startGame(roomId: string) {
    const room = await this.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    // Update room status to PROMPT_ENTRY
    await redis.hset(this.roomKey(roomId), "status", "PROMPT_ENTRY");
    
    const updatedRoom = await this.get(roomId);
    await this.publish(updatedRoom);
    return updatedRoom;
  },

  async publish(room: any) {
    if (room && room.id) {
      await pubsub.publish(`ROOM:${room.id}`, { room });
    }
  }
}