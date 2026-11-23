import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  db!: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  redis!: 'up' | 'down';

  @ApiProperty({ example: '2026-11-17T22:30:00.000Z' })
  timestamp!: string;
}
