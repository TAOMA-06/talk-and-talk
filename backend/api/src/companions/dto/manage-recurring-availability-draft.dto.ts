import { IsUUID } from "class-validator";

/** The draft id is server-generated; activation has no writable body fields. */
export class OwnRecurringAvailabilityDraftParamsDto {
  @IsUUID()
  id!: string;
}
