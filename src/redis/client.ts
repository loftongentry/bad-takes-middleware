import Redis from 'ioredis'

export function createRedisClients() {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL is required (Redis-only mode)')
  }

  const base = {
    maxRetriesPerRequest: null as any,
    enableReadyCheck: true,
  }

  const redis = new Redis(url, base)
  const publisher = new Redis(url, base)
  const subscriber = new Redis(url, base)

  return { redis, publisher, subscriber }
}
