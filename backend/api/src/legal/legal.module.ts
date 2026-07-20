import { Module } from "@nestjs/common";

import { LegalController } from "./legal.controller";
import { LegalDocumentArchiveService } from "./legal-document-archive.service";
import { DataRetentionWorker } from "./data-retention.worker";

@Module({
  controllers: [LegalController],
  providers: [LegalDocumentArchiveService, DataRetentionWorker],
  exports: [LegalDocumentArchiveService]
})
export class LegalModule {}
