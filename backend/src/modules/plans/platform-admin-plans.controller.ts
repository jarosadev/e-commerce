import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreatePlanDto, PlanResponseDto, UpdatePlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Platform Admin - Plans')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access_token')
@Roles(PlatformRole.SUPER_ADMIN)
@SkipTenantStatus()
@Controller('platform-admin/plans')
export class PlatformAdminPlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos los planes SaaS (incluidos inactivos) para SuperAdmin' })
  @ApiOkResponse({ type: [PlanResponseDto] })
  listAllPlans(): Promise<PlanResponseDto[]> {
    return this.plansService.listAllPlans();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un nuevo plan SaaS' })
  @ApiCreatedResponse({ type: PlanResponseDto })
  createPlan(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.plansService.createPlan(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualiza precios, límites o estado de un plan SaaS' })
  @ApiOkResponse({ type: PlanResponseDto })
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<PlanResponseDto> {
    return this.plansService.updatePlan(id, dto);
  }
}
