export const typeDefs = /* GraphQL */ `
  enum RoomStatus { LOBBY PROMPTING DEFENDING RESULTS }

  type Player {
    id: ID!
    name: String!
    isHost: Boolean!
    score: Int!
  }

  type RoomSettings {
    lobbyName: String!
    rounds: Int!
    playerLimit: Int!
    timeLimit: Int!
  }

  type Room {
    id: ID!
    joinCode: String!
    status: RoomStatus!
    settings: RoomSettings!
    players: [Player!]!
  }

  type CreateRoomPayload {
    room: Room!
    hostPlayerId: ID!
  }

  type JoinRoomPayload {
    room: Room!
    playerId: ID!
  }

  type Query {
    health: String!
    roomById(roomId: ID!): Room
    roomByJoinCode(joinCode: String!): Room
  }

  type Mutation {
    ping(message: String!): String!

    createRoom(
      hostName: String!
      lobbyName: String!
      rounds: Int!
      playerLimit: Int!
      timeLimit: Int!
    ): CreateRoomPayload!

    joinRoom(joinCode: String!, playerName: String!): JoinRoomPayload!
    leaveRoom(roomId: ID!, playerId: ID!): Room!
    kickPlayer(roomId: ID!, playerId: ID!): Room!
    startGame(roomId: ID!): Room!
  }

  type Subscription {
    roomUpdated(roomId: ID!): Room!
  }
`
