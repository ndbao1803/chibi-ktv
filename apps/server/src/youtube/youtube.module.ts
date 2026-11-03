import { Module } from '@nestjs/common';
import { YouTubeService } from './youtube.service.js';

@Module({
  providers: [{ provide: YouTubeService, useFactory: () => new YouTubeService() }],
  exports: [YouTubeService],
})
export class YouTubeModule {}
