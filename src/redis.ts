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
    if (!roomId) return null;

    try {
      // Pipeline: Fetch room metadata + players in one trip
      const [roomRes, playersRes] = await redis
        .pipeline()
        .hgetall(this.roomKey(roomId))
        .hgetall(this.playersKey(roomId))
        .exec() as [any, any];

      // Check for Pipeline Errors
      if (roomRes[0]) {
        throw new Error(`Redis Pipeline Error (Room): ${roomRes[0]}`);
      }
      if (playersRes[0]) {
        throw new Error(`Redis Pipeline Error (Players): ${playersRes[0]}`);
      }

      const roomData = roomRes[1];
      const playersData = playersRes[1];

      if (!roomData || Object.keys(roomData).length === 0) {
        return null;
      }

      let players = [];
      try {
        players = Object.values(playersData).map((p: any) => JSON.parse(p));
      } catch (parseErr) {
        console.error(`[RoomStore.get] Failed to parse players for room ${roomId}:`, parseErr);
        players = [];
      }

      let gameState = null;
      try {
        gameState = roomData.gameState ? JSON.parse(roomData.gameState) : null;
      } catch (parseErr) {
        console.error(`[RoomStore.get] Failed to parse gameState for room ${roomId}:`, parseErr);
      }

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

    } catch (error) {
      console.error(`[RoomStore.get] Critical failure fetching room ${roomId}:`, error);
      throw new Error("Internal database error");
    }
  },

  // --- Actions ---
  async create(hostName: string, settings: RoomSettings) {
    const roomId = uuid();
    const joinCode = makeJoinCode();

    console.log(`[RoomStore.create] Starting creation for host "${hostName}" (Room: ${roomId})`);

    const host = { id: uuid(), name: hostName, isHost: true, score: 0 };

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
    };

    try {
      const results = await redis.multi()
        .hset(this.roomKey(roomId), roomMeta)
        .expire(this.roomKey(roomId), ONE_HOUR)
        .hset(this.playersKey(roomId), host.id, JSON.stringify(host))
        .expire(this.playersKey(roomId), ONE_HOUR)
        .setex(this.joinKey(joinCode), ONE_HOUR, roomId)
        .exec();

      // Check transaction results
      const errors = results?.filter(r => r[0] !== null);
      if (errors && errors.length > 0) {
        throw new Error(`Redis Transaction Failed: ${errors[0][0]}`);
      }

      console.log(`[RoomStore.create] Success. Room ID: ${roomId}, Join Code: ${joinCode}`);

      const room = await this.get(roomId);
      await this.publish(room);
      return room;

    } catch (error) {
      console.error(`[RoomStore.create] Failed to create room:`, error);
      throw error;
    }
  },

  async join(joinCode: string, playerName: string) {
    try {
      const roomId = await redis.get(this.joinKey(joinCode));
      if (!roomId) {
        console.error(`[RoomStore.join] Invalid code attempt: ${joinCode}`);
        throw new Error("Invalid join code");
      }

      const room = await this.get(roomId);

      if (!room) {
        throw new Error("Room found in index but missing in storage (Expired?)");
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

      console.log(`[RoomStore.join] ${playerName} joined room ${roomId}`);
      return { room: updatedRoom, playerId: newPlayer.id };

    } catch (error: any) {
      console.error(`[RoomStore.join] Error joining with code ${joinCode}:`, error.message);
      throw error;
    }
  },

  // TODO: need to handle removing a prompt if a player leaves mid-game (if their prompt has already been used, decrease the prompt count, else remove the user who lefts's prompt)
  async leave(roomId: string, playerId: string) {
    try {
      const room = await this.get(roomId);
      if (!room) {
        console.warn(`[RoomStore.leave] Ignored: Room ${roomId} does not exist`);
        return;
      }

      const player = room.players.find((p: any) => p.id === playerId);
      if (!player) {
        console.warn(`[RoomStore.leave] Ignored: Player ${playerId} not in room ${roomId}`);
        return;
      }

      if (player.isHost) {
        console.log(`[RoomStore.leave] Host left. Destroying room ${roomId}`);

        await redis.multi()
          .del(this.roomKey(roomId))
          .del(this.playersKey(roomId))
          .del(this.joinKey(room.joinCode))
          .exec();

        await pubsub.publish(`ROOM:${room.id}`, { room: null });
      } else {
        console.log(`[RoomStore.leave] Player ${playerId} left room ${roomId}`);

        await redis.hdel(this.playersKey(roomId), playerId);
        const updatedRoom = await this.get(roomId);
        await this.publish(updatedRoom);
      }
    } catch (error) {
      console.error(`[RoomStore.leave] Error handling leave for ${roomId}:`, error);
    }
  },

  async kick(roomId: string, playerId: string) {
    try {
      const room = await this.get(roomId);
      if (!room) {
        return;
      }

      const player = room.players.find((p: any) => p.id === playerId);
      if (!player) {
        console.warn(`[RoomStore.kick] Failed: Player ${playerId} not found in ${roomId}`);
        return;
      }

      console.log(`[RoomStore.kick] Kicking player ${playerId} from ${roomId}`);

      await redis.hdel(this.playersKey(roomId), playerId);
      const updatedRoom = await this.get(roomId);
      await this.publish(updatedRoom);

    } catch (error) {
      console.error(`[RoomStore.kick] Error kicking player:`, error);
      throw new Error("Failed to kick player");
    }
  },

  // TODO: Need to add logic to force faster entry of prompts based on timeLimit setting
  async startGame(roomId: string) {
    try {
      const room = await this.get(roomId);
      if (!room) {
        throw new Error("Room not found")
      };

      console.log(`[RoomStore.startGame] Starting game for room ${roomId}`);

      await redis.hset(this.roomKey(roomId), "status", "PROMPT_ENTRY");

      const updatedRoom = await this.get(roomId);
      if (!updatedRoom) {
        throw new Error("Failed to fetch updated room state");
      }

      await this.publish(updatedRoom);
      return updatedRoom;

    } catch (error) {
      console.error(`[RoomStore.startGame] Failed to start game ${roomId}:`, error);
      throw error;
    }
  },

  async submitPrompt(roomId: string, playerId: string, prompt: string) {
    try {
      const room = await this.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      // Default game state if state doesn't exist
      const state = room.gameState || { prompts: [], queue: [], votes: {}, currentTurn: null };

      // Add prompt
      state.prompts.push({
        id: uuid(),
        authorId: playerId,
        text: prompt
      });

      // Check to see if everyone has submitted
      if (state.prompts.length >= room.players.length) {
        // Generate the turn queue (who defends what)
        state.queue = this._generateQueue(room.players, state.prompts);

        // Save the state (before starting turn)
        await redis.hset(this.roomKey(roomId), "gameState", JSON.stringify(state));

        // Transition to first turn
        await this.startTurn(roomId);
      } else {
        // Not all prompts in yet, just save state
        await redis.hset(this.roomKey(roomId), "gameState", JSON.stringify(state));
      }

      // Notify subscribers in room
      const updatedRoom = await this.get(roomId);
      await this.publish(updatedRoom);
      return true;
    } catch (error) {
      console.error(`[RoomStore.submitPrompt] Failed to submit prompt for room ${roomId}:`, error);
      throw error;
    }
  },

  async startTurn(roomId: string) {
    const room = await this.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    // Get raw state object
    const rawState = await redis.hget(this.roomKey(roomId), "gameState");
    const state = rawState ? JSON.parse(rawState) : null;
    if (!state) {
      return;
    }

    // Pop the next turn from queue
    const nextTurn = state.queue.shift();

    if (!nextTurn) {
      // No more turns, transition to RESULTS
      await redis.hset(this.roomKey(roomId), "status", "RESULTS");
    } else {
      state.currentTurn = nextTurn;
      state.votes = {};

      // Save updated state
      await redis.multi()
        .hset(this.roomKey(roomId), "gameState", JSON.stringify(state))
        .hset(this.roomKey(roomId), "status", "DEFENSE")
        .exec();
    }

    const finalRoom = await this.get(roomId);
    await this.publish(finalRoom);
  },

  async endTurn(roomId: string) {
    try {
      const room = await this.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      if (room.status !== "DEFENSE") {
        return false;
      }

      console.log(`[GameLogic] Ending turn for room ${roomId}`);

      await redis.hset(this.roomKey(roomId), "status", "VOTING");

      const updatedRoom = await this.get(roomId);
      await this.publish(updatedRoom);
      return true;
    } catch (error) {
      console.error(`[RoomStore.endTurn] Failed to end turn for room ${roomId}:`, error);
      throw error;
    }
  },

  async submitVote(roomId: string, playerId: string, value: number) {
    try {
      const room = await this.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      if (room.status !== "VOTING") {
        throw new Error("Not in voting phase");
      }

      const state = room.gameState;

      if (!state.votes) {
        state.votes = {};
      }

      state.votes[playerId] = value;

      const votersCount = Object.keys(state.votes).length;
      const requiredVotes = room.players.length - 1; // Exclude defender

      console.log(`[GameLogic] Player ${playerId} voted in room ${roomId}: (${votersCount}/${requiredVotes})`);

      if (votersCount >= requiredVotes) {
        console.log(`[GameLogic] All votes in for room ${roomId}, Tallying score...`);
        
        // Calculate round score
        let roundScore = 0;
        Object.values(state.votes).forEach((v: any) => {
          roundScore += v;
        });

        // Update defender's score
        const defenderId = state.currentTurn.defenderId;
        const playerIndex = room.players.findIndex((p: any) => p.id === defenderId);

        if (playerIndex !== -1) {
          // Update the raw JSON string in Redis
          const players = room.players;
          players[playerIndex].score += roundScore;
          
          // Save updated player list
          await redis.hset(this.playersKey(roomId), defenderId, JSON.stringify(players[playerIndex]));
        }

        // Clear votes for next round
        state.votes = {};
        // Save cleared state immediately so next round is clean
        await redis.hset(this.roomKey(roomId), "gameState", JSON.stringify(state));
        
        // Start next turn or end game
        await this.startTurn(roomId);
      } else {
        // Waiting for others
        await redis.hset(this.roomKey(roomId), "gameState", JSON.stringify(state));
        const updatedRoom = await this.get(roomId);
        await this.publish(updatedRoom);
      }

      return true;
    } catch (error) {
      console.error(`[RoomStore.submitVote] Failed to submit vote for room ${roomId}:`, error);
      throw error;
    }
  },

  _generateQueue(players: any[], prompts: any[]) {
    // Shuffle prompts randomly
    const shuffledPrompts = [...prompts].sort(() => 0.5 - Math.random());

    // Assign each player a prompt to defend 
    // TODO: add in logic to avoid self-defense
    return players.map((p, i) => ({
      defenderId: p.id,
      promptId: shuffledPrompts[i % shuffledPrompts.length].id,
      promptText: shuffledPrompts[i % shuffledPrompts.length].text
    }));
  },

  async publish(room: any) {
    if (room && room.id) {
      try {
        await pubsub.publish(`ROOM:${room.id}`, { room });
      } catch (e) {
        console.error(`[RoomStore.publish] PubSub failure for ${room.id}:`, e);
      }
    }
  }
}