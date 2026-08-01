import { Transform, Type } from "class-transformer";
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import { RECOMMENDATION_TOPICS } from "../../recommendations/recommendation-topics";

const DISCOVER_TOPIC_IDS = RECOMMENDATION_TOPICS.map((topic) => topic.id);
const DISCOVER_DELIVERY_MODES = ["text", "voice"] as const;
export const PUBLIC_COMPANION_SORTS = ["online", "rating", "reviewCount", "priceAsc", "soonestAvailable"] as const;
export type PublicCompanionSort = (typeof PUBLIC_COMPANION_SORTS)[number];

export class ListCompanionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  tag?: string;

  /** Exact, customer-selected language from the public profile. */
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  language?: string;

  /**
   * Exact customer-selected specialty / interaction style from the public
   * profile. This never inspects private applications, review notes or KYC.
   */
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  specialty?: string;

  /**
   * A short, explicitly submitted public-catalog keyword. It is normalized at
   * the edge and is never persisted as a user preference or behavior signal.
   */
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  keyword?: string;

  /**
   * Customer-selected ordering for the public catalog. Omitted keeps the
   * existing catalog order; it never substitutes a private ranking signal.
   * soonestAvailable is separately resolved from current structured capacity
   * and is not an appointment reservation.
   */
  @IsOptional()
  @IsIn(PUBLIC_COMPANION_SORTS)
  sortBy?: PublicCompanionSort;

  @IsOptional()
  @IsIn(["online", "available", "busy"])
  availability?: "online" | "available" | "busy";

  @IsOptional()
  @IsBooleanString()
  isOnline?: string;

  /**
   * Explicit discovery filters are matched against an active public service
   * offering, rather than profile copy or personalization data.
   */
  @IsOptional()
  @IsIn(DISCOVER_TOPIC_IDS)
  topicId?: string;

  @IsOptional()
  @IsIn(DISCOVER_DELIVERY_MODES)
  deliveryMode?: (typeof DISCOVER_DELIVERY_MODES)[number];

  /** Upper bound in cents for one current active service offering. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(2_000_000)
  maxServicePriceCents?: number;

  /** Limit the catalog to structured services with a current free candidate. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  availableWithinDays?: number;
}
