import { makeExecutableSchema } from "@graphql-tools/schema";
import { PubSub } from "graphql-subscriptions";
const pubsub = new PubSub();
const TOPIC_PINGED = 'PINGED'

export const typeDefs = /* GraphQL */ `
  type Query {
    health: String!
  }

  type Mutation {
    ping(message: String!): String!
  }

  type Subscription {
    pinged: String!
  }
`;

export const resolvers = {
  Query: {
    health: () => "OK",
  },
  Mutation: {
    ping: async (_: unknown, { message }: { message: string }) => {
      console.log(message)
      const payload = `pong: ${message}`
      await pubsub.publish(TOPIC_PINGED, { pinged: payload })
      return payload
    },
  },
  Subscription: {
    pinged: {
      subscribe: () => pubsub.asyncIterableIterator([TOPIC_PINGED]),
    },
  },
};

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});