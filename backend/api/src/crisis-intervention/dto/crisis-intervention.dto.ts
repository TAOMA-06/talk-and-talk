import { IsIn, IsOptional, IsString, Matches } from "class-validator";

export const CRISIS_INTERVENTION_SOURCES = [
  "homeIntent",
  "homeBrowseAll",
  "homeRecommendation",
  "discover",
  "companionDetail",
  "order",
  "chatSafetyRule",
  "directEmergencyHelp"
] as const;

export const CRISIS_INTERVENTION_RISK_CODES = [
  "userRequested",
  "selfHarmSignal",
  "violenceSignal",
  "immediateDangerSignal",
  "chatSafetyRule"
] as const;

export type CrisisInterventionSourceInput = typeof CRISIS_INTERVENTION_SOURCES[number];
export type CrisisInterventionRiskCodeInput = typeof CRISIS_INTERVENTION_RISK_CODES[number];

export class CrisisResourcesQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^CN(?:-[0-9]{2})?$/, { message: "region must be CN or a CN province code such as CN-31" })
  region?: string;
}

export class CreateCrisisInterventionDto {
  @IsString()
  @IsIn(CRISIS_INTERVENTION_SOURCES)
  source!: CrisisInterventionSourceInput;

  @IsString()
  @IsIn(CRISIS_INTERVENTION_RISK_CODES)
  riskCode!: CrisisInterventionRiskCodeInput;

  @IsString()
  @Matches(/^CN(?:-[0-9]{2})?$/, { message: "region must be CN or a CN province code such as CN-31" })
  region!: string;
}
