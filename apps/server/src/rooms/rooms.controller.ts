import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { CreateRoomInput, RoomCode, type RoomInfo } from '@ktv/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { TokenUser } from '../auth/auth.service.js';
import { RoomsService } from './rooms.service.js';
import { parseOrThrow } from '../validation.js';

@Controller('api/rooms')
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  create(@CurrentUser() user: TokenUser, @Body() body: unknown): Promise<RoomInfo> {
    return this.rooms.create(user.id, parseOrThrow(CreateRoomInput, body ?? {}));
  }

  @Get(':code')
  async get(@Param('code') code: string): Promise<RoomInfo> {
    const room = await this.rooms.findByCode(parseOrThrow(RoomCode, code));
    if (!room) throw new NotFoundException('Không tìm thấy phòng');
    return room;
  }
}
