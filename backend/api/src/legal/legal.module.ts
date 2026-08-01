import { Module } from "@nestjs/common";

import { LegalController } from "./legal.controller";
import { LegalDocumentArchiveService } from "./legal-document-archive.service";
import { DataRetentionWorker } from "./data-retention.worker";
import { DataRetentionLegalHoldController } from "./data-retention-legal-hold.controller";
import { DataRetentionLegalHoldService } from "./data-retention-legal-hold.service";

@Module({
  controllers: [LegalController, DataRetentionLegalHoldController],
  providers: [LegalDocumentArchiveService, DataRetentionLegalHoldService, DataRetentionWorker],
  exports: [LegalDocumentArchiveService, DataRetentionLegalHoldService]
})
export class LegalModule {}
