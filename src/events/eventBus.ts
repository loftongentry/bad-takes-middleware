import { RedisPubSub } from "graphql-redis-subscriptions";
import type Redis from "ioredis";
import type { Room } from "../store/types";

export class RedisEventBus {
  private pubSub: RedisPubSub;

  constructor(publisher: Redis, subscriber: Redis) {
    this.pubSub = new RedisPubSub({
      publisher,
      subscriber,
    });
  }

  private topicPing(): string {
    return 'ping';
  }

  private topicRoomUpdated(roomId: string): string {
    return `ROOM_UPDATED: ${roomId}`;
  }

  publishPing(event: string, payload: string): Promise<void> {
    return this.pubSub.publish(event, { pinged: payload });
  }

  subscribePing() {
    return this.pubSub.asyncIterator('ping');
  }

  publishRoomUpdated(room: Room): Promise<void> {
    return this.pubSub.publish(this.topicRoomUpdated(room.id), { roomUpdated: room });
  }

  subscribeRoomUpdated(roomId: string){
    return this.pubSub.asyncIterator(this.topicRoomUpdated(roomId));
  }
}