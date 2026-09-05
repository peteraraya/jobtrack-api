import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JobOffersService } from './job-offers.service.js';
import { CreateJobOfferDto } from './dto/create-job-offer.dto.js';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto.js';
import { ListJobOffersQueryDto } from './dto/list-job-offers-query.dto.js';

@Controller('job-offers')
export class JobOffersController {
  constructor(private readonly jobOffersService: JobOffersService) {}

  // Lectura pública (catálogo) con paginación por cursor; escritura solo admin.
  @Public()
  @Get()
  findAll(@Query() query: ListJobOffersQueryDto) {
    return this.jobOffersService.findAll(query.limit, query.cursor);
  }

  @Public()
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.jobOffersService.findById(id);
  }

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateJobOfferDto) {
    return this.jobOffersService.create(dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobOfferDto) {
    return this.jobOffersService.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  delete(@Param('id') id: string) {
    this.jobOffersService.delete(id);
  }
}
