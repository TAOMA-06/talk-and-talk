import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateReviewDto } from "./dto/review.dto";
import { ListReviewsDto } from "./dto/list-reviews.dto";
import { ReviewsService } from "./reviews.service";

@Controller("reviews")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get("companion/:id")
  list(@Param("id") id: string, @Query() query: ListReviewsDto) {
    return this.reviews.list(id, query);
  }

  @Get("orders/:orderId/me")
  @UseGuards(JwtAuthGuard)
  findOwnForOrder(@CurrentUser() user: AuthenticatedUser, @Param("orderId") orderId: string) {
    return this.reviews.findOwnForOrder(user.id, orderId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.id, dto);
  }
}
