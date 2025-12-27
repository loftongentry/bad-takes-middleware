import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import cors from 'cors';
import { schema } from './schema';

const GRAPH_QL = '/graphql'
const PORT = process.env.PORT || 3500

async function main() {
  const app = express();
  const httpServer = createServer(app);
  const wsServer = new WebSocketServer({ server: httpServer, path: GRAPH_QL });
  const serverCleanup = useServer({ schema }, wsServer);

  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();

              // Close existing WebSocket connections.
              await new Promise<void>((resolve) => {
                wsServer.close(() => {
                  resolve()
                })
              })
            }
          }
        }
      }
    ]
  });

  await server.start();

  app.use(
    GRAPH_QL,
    cors(),
    express.json(),
    expressMiddleware(server)
  );

  app.get('/health', (_req, res) => {
    res.send('OK')
  })

  httpServer.listen(PORT, () => {
    console.log(`HTTP: http://localhost:${PORT}${GRAPH_QL}`)
    console.log(`WS:   ws://localhost:${PORT}${GRAPH_QL}`)
  });
}

main().catch((err) => {
  console.error('Server failed to start', err);
  process.exit(1);
});