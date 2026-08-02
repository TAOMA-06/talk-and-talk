import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";

import { AuthController } from "./auth.controller";
import { AuthIdentityTombstoneService } from "./auth-identity-tombstone.service";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SmsModule } from "./sms/sms.module";

/**
 * Global so feature modules that only declare `@UseGuards(JwtAuthGuard)` can
 * resolve JwtAuthGuard's AuthIdentityTombstoneService dependency without each
 * re-importing AuthModule. Tombstone blocking on every authenticated request is
 * a cross-cutting account-deletion control, not a crisis-only concern.
 */
@Global()
@Module({
  imports: [PassportModule, JwtModule.register({}), SmsModule],
  controllers: [AuthController],
  providers: [AuthIdentityTombstoneService, AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthIdentityTombstoneService, AuthService, JwtAuthGuard]
})
export class AuthModule {}
