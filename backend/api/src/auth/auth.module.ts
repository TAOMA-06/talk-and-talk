import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";

import { AuthController } from "./auth.controller";
import { AuthIdentityTombstoneService } from "./auth-identity-tombstone.service";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SmsModule } from "./sms/sms.module";

@Module({
  imports: [PassportModule, JwtModule.register({}), SmsModule],
  controllers: [AuthController],
  providers: [AuthIdentityTombstoneService, AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthIdentityTombstoneService, AuthService, JwtAuthGuard]
})
export class AuthModule {}
