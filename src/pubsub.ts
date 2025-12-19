import { PubSub } from 'graphql-subscriptions'
import type { Room } from './store/types.js'

export const TOPICS = {
  PINGED: 'PINGED',
  roomUpdated: (roomId: string) => `ROOM_UPDATED:${roomId}`, // per-room topic avoids filtering
} as const

type Events = {
  [TOPICS.PINGED]: { pinged: string }
  // dynamic keys (ROOM_UPDATED:<id>) aren’t expressible as literal types easily,
  // so we keep PubSub generic and rely on correct payload shape.
  [key: string]: any
}

export const pubsub = new PubSub<Events>()

export function publishPinged(payload: string) {
  return pubsub.publish(TOPICS.PINGED, { pinged: payload })
}

export function publishRoomUpdated(room: Room) {
  // Publish to a room-specific channel so only that room’s subscribers receive updates.
  return pubsub.publish(TOPICS.roomUpdated(room.id), { roomUpdated: room })
}
