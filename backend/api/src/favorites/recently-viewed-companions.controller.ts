import { Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { FavoritesService } from "./favorites.service";

@Controller("recently-viewed/companions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("user")
export class RecentlyViewedCompanionsController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.listRecentlyViewedCompanions(user.id);
  }

  @Put(":id")
  record(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.favorites.recordRecentlyViewedCompanion(user.id, id);
  }

  @Delete()
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.clearRecentlyViewedCompanions(user.id);
  }
}
