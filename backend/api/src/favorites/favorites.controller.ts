import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { SetFavoriteAvailabilityReminderDto } from "./dto/set-favorite-availability-reminder.dto";
import { ListFavoriteCompanionsDto } from "./dto/list-favorite-companions.dto";
import { FavoritesService } from "./favorites.service";

@Controller("favorites/companions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("user")
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListFavoriteCompanionsDto) {
    return this.favorites.listCompanions(user.id, query);
  }

  @Get(":id/status")
  status(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.favorites.companionStatus(user.id, id);
  }

  @Put(":id")
  save(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.favorites.saveCompanion(user.id, id);
  }

  @Put(":id/availability-reminder")
  setAvailabilityReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SetFavoriteAvailabilityReminderDto
  ) {
    return this.favorites.setAvailabilityReminder(user.id, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.favorites.removeCompanion(user.id, id);
  }
}
