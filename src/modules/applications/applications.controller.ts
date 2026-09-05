import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ApplicationsService } from './applications.service.js';
import { CreateApplicationDto } from './dto/create-application.dto.js';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthedUser) {
    // Reto N+1 (1 query con joins) + scope: admin ve todo, el usuario solo
    // sus postulaciones (ownership por el token, nunca por query param).
    return user.role === 'admin'
      ? this.applicationsService.findAllWithDetails()
      : this.applicationsService.findAllByUserWithDetails(user.id);
  }

  @Post()
  apply(@CurrentUser() user: AuthedUser, @Body() dto: CreateApplicationDto) {
    return this.applicationsService.apply(user.id, dto);
  }

  @Patch(':id')
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.applicationsService.updateStatus(id, user, dto.status);
  }
}
