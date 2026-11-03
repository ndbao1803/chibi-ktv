import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller.js';
import { RoomsGateway } from './rooms.gateway.js';
import { RoomsService } from './rooms.service.js';
import { RoomLiveService } from './room-live.service.js';
import { YouTubeModule } from '../youtube/youtube.module.js';
import { RtcController } from '../rtc/rtc.controller.js';

@Module({
  imports: [YouTubeModule],
  controllers: [RoomsController, RtcController],
  providers: [RoomsService, RoomsGateway, RoomLiveService],
})
export class RoomsModule {}
