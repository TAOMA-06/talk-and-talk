import { IsDateString, IsOptional } from "class-validator";

export class CommercialFunnelQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
