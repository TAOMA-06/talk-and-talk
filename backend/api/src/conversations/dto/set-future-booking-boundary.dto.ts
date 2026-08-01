import { IsBoolean } from "class-validator";

export class SetFutureBookingBoundaryDto {
  @IsBoolean()
  declined!: boolean;
}
