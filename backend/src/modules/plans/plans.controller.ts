import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { PlanResponseDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @Public()
  @SkipTenantStatus()
  @ApiOperation({ summary: 'Lista planes SaaS activos ordenados por sortOrder y precio' })
  @ApiOkResponse({ type: [PlanResponseDto] })
  listPublicPlans(): Promise<PlanResponseDto[]> {
    return this.plansService.listPublicPlans();
  }
}
