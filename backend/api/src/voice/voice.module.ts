import { Module } from "@nestjs/common";

import { VoiceRoomControlService } from "./voice-room-control.service";
import { VoiceRoomTerminationWorker } from "./voice-room-termination.worker";
import { VoiceService } from "./voice.service";

@Module({
  providers: [VoiceService, VoiceRoomControlService, VoiceRoomTerminationWorker],
  exports: [VoiceService, VoiceRoomControlService]
})
export class VoiceModule {}
