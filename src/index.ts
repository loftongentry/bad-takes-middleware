import 'dotenv/config'
import express, { json } from 'express'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { schema } from './schema'
import { expressMiddleware } from '@as-integrations/express5'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { useServer } from 'graphql-ws/use/ws'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'

const PORT = Number(process.env.PORT) || 4000
const GRAPH_QL = '/graphql'

async function main() {
  const app = express()
  app.use(cors())
  app.use(json())

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
              wsCleanup.dispose()
            },
          }
        },
      },
    ],
  })

  await server.start()

  app.use(GRAPH_QL, expressMiddleware(server))

  app.get('/health', (_req, res) => {
    res.send('OK')
  })

  httpServer.listen(PORT, () => {
    console.log(`HTTP: http://localhost:${PORT}${GRAPH_QL}`)
    console.log(`WS:   ws://localhost:${PORT}${GRAPH_QL}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server', err)
  process.exit(1)
})