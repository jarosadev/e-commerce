import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { HealthResponseDto } from './health.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @SkipTenantStatus()
  @SkipThrottle()
  @ApiOperation({ summary: 'Verifica estado de PostgreSQL y Redis' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'Servicios operativos' })
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto,
    description: 'Al menos un servicio dependiente está caído',
  })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    const result = await this.healthService.check();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
