// TODO: Track who submitted prompts 
// TODO: Track votes to be able to display users who have and have not voted on when waiting between players' defenses (who are we waiting to vote - should also implement a timer on that as well to force timely voting)
import { makeExecutableSchema } from "@graphql-tools/schema";
import { resolvers } from "./resolvers";

const typeDefs = `
  type RoomSettings {
    lobbyName: String!
    rounds: Int!
    playerLimit: Int!
    timeLimit: Int!
  }
    
  type Player {
    id: ID!
    name: String!
    isHost: Boolean!
    score: Int!
  }

  type TurnInfo {
    defenderId: ID!
    promptId: ID!
    promptText: String!
  }

  type GameState {
    deadline: String
    votesCast: Int
    submittedPromptsCount: Int
    currentTurn: TurnInfo
  }

  type Room {
    id: ID!
    joinCode: String!
    status: String!
    settings: RoomSettings!
    players: [Player!]!
    gameState: GameState
  }

  type CreateResponse { hostId: ID!, room: Room! }
  type JoinResponse { playerId: ID!, room: Room!}

  type Query {
    room(id: ID!): Room
  }

  type Mutation {
    createRoom(hostName: String!, lobbyName: String!, rounds: Int!, playerLimit: Int!, timeLimit: Int!): CreateResponse!
    joinRoom(code: String!, playerName: String!): JoinResponse!
    leaveRoom(roomId: ID!, playerId: ID!): Boolean!
    kickPlayer(roomId: ID!, playerId: ID!): Boolean!
    startGame(roomId: ID!): Room!
    submitPrompt(roomId: ID!, playerId: ID!, prompt: String!): Boolean!
    endTurn(roomId: ID!): Boolean!
    submitVote(roomId: ID!, playerId: ID!, value: Int!): Boolean!
    resetGame(roomId: ID!): Boolean!
  }

  type Subscription {
    room(roomId: ID!): Room
  }
`

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});