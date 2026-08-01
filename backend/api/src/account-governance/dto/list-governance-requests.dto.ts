import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export const DATA_RIGHTS_REQUEST_STATUSES = [
  "submitted",
  "inReview",
  "needsInformation",
  "completed",
  "rejected"
] as const;
export type DataRightsRequestStatusValue = (typeof DATA_RIGHTS_REQUEST_STATUSES)[number];

export const INVOICE_REQUEST_STATUSES = [
  "submitted",
  "inReview",
  "issued",
  "rejected",
  "voided",
  "cancelled"
] as const;
export type InvoiceRequestStatusValue = (typeof INVOICE_REQUEST_STATUSES)[number];

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export class ListDataRightsRequestsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(DATA_RIGHTS_REQUEST_STATUSES)
  status?: DataRightsRequestStatusValue;
}

export class ListInvoiceRequestsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(INVOICE_REQUEST_STATUSES)
  status?: InvoiceRequestStatusValue;
}

export class ListInvoiceEligibleOrdersDto extends PaginationQueryDto {}
