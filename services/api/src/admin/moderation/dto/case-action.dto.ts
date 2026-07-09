import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const ADMIN_CASE_ACTIONS = ["confirmViolation", "dismiss", "escalate"] as const;
export type AdminCaseAction = (typeof ADMIN_CASE_ACTIONS)[number];

export class CaseActionDto {
  @IsIn([...ADMIN_CASE_ACTIONS])
  action!: AdminCaseAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
