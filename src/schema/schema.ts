import { makeExecutableSchema } from '@graphql-tools/schema'
import { typeDefs } from './typeDefs.js'
import { makeResolvers } from './resolvers.js'
import type { RedisRoomStore } from '../store/roomStore.js'
import type { RedisEventBus } from '../events/eventBus.js'

export function makeSchema(deps: { store: RedisRoomStore; events: RedisEventBus }) {
  const resolvers = makeResolvers(deps)
  return makeExecutableSchema({ typeDefs, resolvers })
}
