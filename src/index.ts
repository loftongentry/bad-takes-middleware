import 'dotenv/config'
import express, { json } from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { useServer } from 'graphql-ws/use/ws'
import { ApolloServer } from '@apollo/server'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'
import { expressMiddleware } from '@as-integrations/express5'

import { createRedisClients } from './redis/client.js'
import { RedisEventBus } from './events/eventBus.js'
import { RedisRoomStore } from './store/roomStore.js'
import { makeSchema } from './schema/schema.js'

const PORT = Number(process.env.PORT) || 3500
const GRAPH_QL = '/graphql'

async function main() {
  const { redis, publisher, subscriber } = createRedisClients()

  const store = new RedisRoomStore(redis)
  const events = new RedisEventBus(publisher, subscriber)

  const schema = makeSchema({ store, events })

  const app = express()
  const httpServer = createServer(app)

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: GRAPH_QL,
  })

  const wsCleanup = useServer({ schema }, wsServer)

  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              // Stop accepting new WebSocket connections.
              wsCleanup.dispose()

              // Close existing WebSocket connections.
              await new Promise<void>((resolve) => {
                wsServer.close(() => {
                  resolve()
                })
              })

              // Close Redis connections.
              await Promise.all([
                redis.quit(),
                publisher.quit(),
                subscriber.quit(),
              ])
            },
          }
        },
      },
    ],
  })

  await server.start()

  app.use(GRAPH_QL, cors(), json(), expressMiddleware(server))

  app.get('/health', (_req, res) => {
    res.send('OK')
  })

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP: http://localhost:${PORT}${GRAPH_QL}`)
    console.log(`WS:   ws://localhost:${PORT}${GRAPH_QL}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server', err)
  process.exit(1)
})