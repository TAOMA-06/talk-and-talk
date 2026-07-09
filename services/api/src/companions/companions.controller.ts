import { Controller, Get, Param, Query } from "@nestjs/common";

import { CompanionsService } from "./companions.service";
import { ListCompanionsQueryDto } from "./dto/list-companions.dto";

@Controller("companions")
export class CompanionsController {
  constructor(private readonly companionsService: CompanionsService) {}

  @Get("status")
  status() {
    return { module: "companions", status: "active" };
  }

  @Get()
  list(@Query() query: ListCompanionsQueryDto) {
    return this.companionsService.list(query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.companionsService.getPublished(id);
  }
}
