import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class ResolveSupportTicketDto {
  @IsIn(["resolved", "closed"])
  status!: "resolved" | "closed";

  @IsString()
  @IsSafeOperationalText()
  @MinLength(2)
  @MaxLength(3000)
  resolution!: string;

  @IsIn(["noRefund", "refundInProgress", "safetyEscalated", "privacyRouted"])
  resolutionCode!: "noRefund" | "refundInProgress" | "safetyEscalated" | "privacyRouted";
}
