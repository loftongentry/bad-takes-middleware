export type RoomStatus = 'LOBBY' | 'PROMPTING' | 'DEFENDING' | 'RESULTS'

export type Player = {
  id: string
  name: string
  isHost: boolean
  score: number
}

export type RoomSettings = {
  lobbyName: string
  rounds: number
  playerLimit: number
  timeLimit: number
}

export type Room = {
  id: string
  joinCode: string
  status: RoomStatus
  settings: RoomSettings
  players: Player[]
}
