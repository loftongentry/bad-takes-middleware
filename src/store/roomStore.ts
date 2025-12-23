import type { Redis } from 'ioredis'
import { v4 as uuid } from 'uuid'
import { Room, Player } from './types'
import { makeJoinCode } from '../utils/joinCode'

export type CreateRoomInput = {
  hostName: string
  lobbyName: string
  rounds: number
  playerLimit: number
  timeLimit: number
}

export type JoinRoomInput = {
  joinCode: string
  playerName: string
}

export class RedisRoomStore {
  constructor(private readonly redis: Redis) { }

  // Keys
  private keyJoinIndex(code: string) {
    return `join:${code}` // String -> roomId
  }
  private keyRoom(id: string) {
    return `room:${id}` // Hash -> Room
  }
  private keyPlayers(roomId: string) {
    return `room:${roomId}:players` // Hash -> Player.id -> Player
  }

  private readonly ROOM_TTL = 60 * 30 // 30 minutes

  private clampSettings(input: CreateRoomInput) {
    const hostName = input.hostName.trim()
    const lobbyName = input.lobbyName.trim()

    if (!hostName) {
      throw new Error('hostName required')
    }

    if (!lobbyName) {
      throw new Error('lobbyName required')
    }

    const rounds = Math.max(1, Math.min(5, Math.trunc(input.rounds)))
    const playerLimit = Math.max(2, Math.min(20, Math.trunc(input.playerLimit)))

    // 15-second increments up to 5 minutes
    const step = 15
    const raw = Math.max(step, Math.min(300, Math.trunc(input.timeLimit)))
    const timeLimit = Math.round(raw / step) * step

    return { hostName, lobbyName, rounds, playerLimit, timeLimit }
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    const roomHash = await this.redis.hgetall(this.keyRoom(roomId))
    if (!roomHash || Object.keys(roomHash).length === 0) {
      return null
    }

    const playersHash = await this.redis.hgetall(this.keyPlayers(roomId))
    const players: Player[] = Object.values(playersHash).map((p) => JSON.parse(p))

    return {
      id: roomId,
      joinCode: roomHash.joinCode,
      status: roomHash.status as Room['status'],
      settings: {
        lobbyName: roomHash.lobbyName,
        rounds: Number(roomHash.rounds),
        playerLimit: Number(roomHash.playerLimit),
        timeLimit: Number(roomHash.timeLimit),
      },
      players,
    }
  }

  async getRoomByJoinCode(joinCode: string): Promise<Room | null> {
    const code = joinCode.trim().toUpperCase()
    const roomId = await this.redis.get(this.keyJoinIndex(code))
    if (!roomId) {
      return null
    }
    return this.getRoomById(roomId)
  }

  async createRoom(input: CreateRoomInput): Promise<{ room: Room; hostPlayerId: string }> {
    const { hostName, lobbyName, rounds, playerLimit, timeLimit } = this.clampSettings(input)

    // Reserve a unique join code using SET NX
    let joinCode = makeJoinCode()
    let roomId = uuid()

    // Retry until we get a unique join code
    while (true) {
      roomId = uuid()
      const ok = await this.redis.set(
        this.keyJoinIndex(joinCode),
        roomId,
        'EX',
        this.ROOM_TTL,
        'NX'
      )
      if (ok) {
        break
      }
      joinCode = makeJoinCode()
    }

    const host: Player = {
      id: uuid(),
      name: hostName,
      isHost: true,
      score: 0,
    }

    // Store authoritative room state in Redis
    await this.redis
      .multi()
      .hset(this.keyRoom(roomId), {
        joinCode,
        status: 'LOBBY',
        lobbyName,
        rounds: rounds.toString(),
        playerLimit: playerLimit.toString(),
        timeLimit: timeLimit.toString(),
      })
      .expire(this.keyRoom(roomId), this.ROOM_TTL)
      .hset(this.keyPlayers(roomId), host.id, JSON.stringify(host))
      .expire(this.keyPlayers(roomId), this.ROOM_TTL)
      .exec()

    const room: Room = {
      id: roomId,
      joinCode,
      status: 'LOBBY',
      settings: {
        lobbyName,
        rounds,
        playerLimit,
        timeLimit,
      },
      players: [host],
    }

    return { room, hostPlayerId: host.id }
  }

  // Lua join to enforce max players atomically
  private readonly joinLua = `
    local joinKey = KEYS[1]
    local roomKey = KEYS[2]
    local playersKey = KEYS[3]

    local code = ARGV[1]
    local playerLimit = tonumber(ARGV[2])
    local playerId = ARGV[3]
    local playerJson = ARGV[4]
    local ttl = tonumber(ARGV[5])

    local roomId = redis.call("GET", joinKey)
    if not roomId then
      return -1
    end

    local status = redis.call("HGET", roomKey, "status")
    if not status then
      return -1
    end
    if status ~= "LOBBY" then
      return -2
    end

    local count = redis.call("HLEN", playersKey)
    if count >= playerLimit then
      return -3
    end

    redis.call("HSET", playersKey, playerId, playerJson)
    redis.call("EXPIRE", joinKey, ttl)
    redis.call("EXPIRE", roomKey, ttl)
    redis.call("EXPIRE", playersKey, ttl)

    return 1
  `
  
  async joinRoom(input: JoinRoomInput): Promise<{ room: Room; playerId: string }> {
    const code = input.joinCode.trim().toUpperCase()
    const name = input.playerName.trim()

    if (!code) {
      throw new Error('joinCode required')
    }

    if (!name) {
      throw new Error('playerName required')
    }

    // Look up roomId first so we can read settings
    const roomId = await this.redis.get(this.keyJoinIndex(code))
    if (!roomId) {
      throw new Error('Room not found')
    }

    const roomHash = await this.redis.hgetall(this.keyRoom(roomId))
    if (!roomHash || Object.keys(roomHash).length === 0) {
      throw new Error('Room not found')
    }

    const playerLimit = Number(roomHash.playerLimit)
    const player: Player = {
      id: uuid(),
      name,
      isHost: false,
      score: 0,
    }

    // Attempt to join via Lua script
    const res = await this.redis.eval(
      this.joinLua,
      3,
      this.keyJoinIndex(code),
      this.keyRoom(roomId),
      this.keyPlayers(roomId),
      code,
      playerLimit.toString(),
      player.id,
      JSON.stringify(player),
      this.ROOM_TTL.toString()
    ) as number

    if (res === -1) {
      throw new Error('Room not found')
    }
    if (res === -2) {
      throw new Error('Cannot join room: game already in progress')
    }
    if (res === -3) {
      throw new Error('Cannot join room: player limit reached')
    }
    if (res !== 1) {
      throw new Error('Failed to join room')
    }

    // Return updated room state
    const room = await this.getRoomById(roomId)
    if (!room) {
      throw new Error('Room not found after joining')
    }

    return { room, playerId: player.id }
  }

  async leaveRoom(roomId: string, playerId: string): Promise<Room> {
    // Remove player from room
    await this.redis.hdel(this.keyPlayers(roomId), playerId)

    // Return updated room state
    const room = await this.getRoomById(roomId)
    if (!room) {
      throw new Error('Room not found after leaving')
    }

    return room
  }

  async kickPlayer(roomId: string, playerId: string): Promise<Room> {
    // Remove player from room
    await this.redis.hdel(this.keyPlayers(roomId), playerId)

    // Return updated room state
    const room = await this.getRoomById(roomId)   

    if (!room) {
      throw new Error('Room not found after kicking player')
    }

    return room
  }
  
  async startGame(roomId: string): Promise<Room> {
    const roomKey = this.keyRoom(roomId)  
    // Update room status to IN_GAME
    await this.redis.hset(roomKey, 'status', 'IN_GAME')
    
    // Return updated room state
    const room = await this.getRoomById(roomId)
    if (!room) {
      throw new Error('Room not found after starting game')
    }

    return room
  }
}
