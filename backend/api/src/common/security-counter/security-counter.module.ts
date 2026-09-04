import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { SecurityCounterService } from "./security-counter.service";

@Module({
  imports: [DatabaseModule],
  providers: [SecurityCounterService],
  exports: [SecurityCounterService]
})
export class SecurityCounterModule {}
