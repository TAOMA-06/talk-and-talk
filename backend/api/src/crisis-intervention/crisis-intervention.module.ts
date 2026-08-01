import { Module } from "@nestjs/common";

import { CrisisInterventionController } from "./crisis-intervention.controller";
import { CrisisInterventionService } from "./crisis-intervention.service";

@Module({
  controllers: [CrisisInterventionController],
  providers: [CrisisInterventionService],
  exports: [CrisisInterventionService]
})
export class CrisisInterventionModule {}
