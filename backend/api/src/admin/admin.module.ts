import { Module } from "@nestjs/common";

import { AccountGovernanceModule } from "../account-governance/account-governance.module";
import { CompanionsModule } from "../companions/companions.module";
import { CommercialModule } from "../commercial/commercial.module";
import { PaymentsModule } from "../payments/payments.module";
import { ModerationModule } from "../moderation/moderation.module";
import { SupportModule } from "../support/support.module";
import { UsersModule } from "../users/users.module";
import { AdminController } from "./admin.controller";
import { AdminOperationsController } from "./admin-operations.controller";
import { AdminStaffController } from "./admin-staff.controller";
import { AdminCommercialController } from "./commercial/admin-commercial.controller";
import { AdminPaymentReconciliationController } from "./commercial/admin-payment-reconciliation.controller";
import { IdentityVerificationService } from "./identity-verification.service";
import { StaffOffboardingService } from "./staff-offboarding.service";

@Module({
  imports: [AccountGovernanceModule, CompanionsModule, UsersModule, PaymentsModule, ModerationModule, CommercialModule, SupportModule],
  // Moderation is deliberately not an AdminModule concern. Review staff now
  // authenticate through ReviewModule and receive a separate token domain.
  controllers: [
    AdminController,
    AdminCommercialController,
    AdminPaymentReconciliationController,
    AdminOperationsController,
    AdminStaffController
  ],
  providers: [IdentityVerificationService, StaffOffboardingService]
})
export class AdminModule {}
