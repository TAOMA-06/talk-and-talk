import { Module } from "@nestjs/common";

import { CommercialController } from "./commercial.controller";
import { CommercialFunnelService } from "./commercial-funnel.service";
import { CommercialSettlementWorker } from "./commercial-settlement.worker";
import { CommercialService } from "./commercial.service";

@Module({
  controllers: [CommercialController],
  providers: [CommercialService, CommercialFunnelService, CommercialSettlementWorker],
  exports: [CommercialService, CommercialFunnelService]
})
export class CommercialModule {}
