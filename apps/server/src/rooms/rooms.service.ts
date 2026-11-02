import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { CreateRoomInput, RoomInfo } from '@ktv/shared';
import { DB, type Database } from '../db/db.module.js';
import { rooms, users } from '../db/schema.js';

// No 0/O or 1/I, so codes are easy to read out loud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

@Injectable()
export class RoomsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(ownerId: string, input: CreateRoomInput): Promise<RoomInfo> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const inserted = await this.db
        .insert(rooms)
        .values({ code, name: input.name, capacity: input.capacity, ownerId })
        .onConflictDoNothing({ target: rooms.code })
        .returning();
      if (inserted.length) return (await this.findByCode(code))!;
    }
    throw new Error('Could not create a unique room code');
  }

  async findByCode(code: string): Promise<RoomInfo | null> {
    const [row] = await this.db
      .select({ code: rooms.code, name: rooms.name, capacity: rooms.capacity, ownerName: users.displayName })
      .from(rooms)
      .innerJoin(users, eq(rooms.ownerId, users.id))
      .where(eq(rooms.code, code))
      .limit(1);
    return row ?? null;
  }
}
