import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { MeController } from "./me.controller";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule],
  controllers: [UsersController, MeController],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
