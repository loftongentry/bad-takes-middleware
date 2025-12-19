import { v4 as uuid } from 'uuid'
import type { Player, Room, RoomSettings } from './types.js'
import { makeJoinCode } from '../utils/joinCode.js'

const roomsById = new Map<string, Room>()
const roomIdByJoinCode = new Map<string, string>()

type RoomSettingsInput = {
  lobbyName: string
  rounds: number
  playerLimit: number
  timeLimit: number
}

type CreateRoomInput = {
  hostName: string
  lobbyName: string
  rounds: number
  playerLimit: number
  timeLimit: number
}

function clampSettings(input: RoomSettingsInput): RoomSettings {
  const lobbyName = input.lobbyName.trim()

  const rounds = Math.max(1, Math.min(5, Math.trunc(input.rounds)))
  const playerLimit = Math.max(2, Math.min(20, Math.trunc(input.playerLimit)))

  // 15-second steps, max 5 minutes
  const step = 15
  const raw = Math.max(step, Math.min(300, Math.trunc(input.timeLimit)))
  const timeLimit = Math.round(raw / step) * step

  return { lobbyName, rounds, playerLimit, timeLimit }
}

export function getRoomById(roomId: string): Room | null {
  return roomsById.get(roomId) ?? null
}

export function getRoomByJoinCode(joinCode: string): Room | null {
  const code = joinCode.trim().toUpperCase()
  const roomId = roomIdByJoinCode.get(code)
  return roomId ? roomsById.get(roomId) ?? null : null
}

export function createRoom(input: CreateRoomInput): { room: Room; hostPlayerId: string } {
  const hostName = input.hostName.trim()
  if (!hostName) { throw new Error('hostName required') }

  const settings = clampSettings(input)
  if (!settings.lobbyName) { throw new Error('lobbyName required') }

  // Unique join code
  let joinCode = makeJoinCode()
  while (roomIdByJoinCode.has(joinCode)) { joinCode = makeJoinCode() }

  const roomId = uuid()
  const host: Player = { id: uuid(), name: hostName, isHost: true, score: 0 }

  const room: Room = {
    id: roomId,
    joinCode,
    status: 'LOBBY',
    settings,
    players: [host],
  }

  roomsById.set(roomId, room)
  roomIdByJoinCode.set(joinCode, roomId)

  return { room, hostPlayerId: host.id }
}

export function joinRoom(input: { joinCode: string; playerName: string }): Room {
  const code = input.joinCode.trim().toUpperCase()
  const name = input.playerName.trim()
  if (!code) { throw new Error('joinCode required') }
  if (!name) { throw new Error('playerName required') }

  const room = getRoomByJoinCode(code)
  if (!room) { throw new Error('Room not found') }
  if (room.status !== 'LOBBY') { throw new Error('Game already started') }
  if (room.players.length >= room.settings.playerLimit) { throw new Error('Room full') }

  const player: Player = { id: uuid(), name, isHost: false, score: 0 }
  room.players.push(player)

  return room
}
