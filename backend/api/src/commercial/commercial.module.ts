import { Module } from "@nestjs/common";

import { CommercialController } from "./commercial.controller";
import { CommercialSettlementWorker } from "./commercial-settlement.worker";
import { CommercialService } from "./commercial.service";

@Module({
  controllers: [CommercialController],
  providers: [CommercialService, CommercialSettlementWorker],
  exports: [CommercialService]
})
export class CommercialModule {}
